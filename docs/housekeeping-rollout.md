# 清掃・予約取り込み修正（2026-10-14）

対象は `nino-0813/hotelPG-saas` のみ。基点は最新 origin/main の `7e243a87ee75094f32c2acf7d290b0222c5e9d2c`。
本番・共有 DB、実 OTA、メール、通知、決済には接続していない。PR / merge / deploy は未実施。後続のユーザー承認により、検証後に専用ブランチだけを origin へ push する（main へは push しない）。

## 原因と実装

- iCal 同期が毎回 `status=confirmed` と `check_out_time=11:00` を upsert していた。新規 INSERT（10:00）と既存 UPDATE を分離し、既存の入退室時刻・状態を更新しない。キャンセル行をスキップし、更新直前にキャンセルされても条件付き UPDATE で復活させない。重複 UID を一回にまとめ、読取り失敗は中断、部分失敗・キャンセル更新失敗もエラーとして返す。
- `STATUS:CANCELLED` を VEVENT パーサーで扱い、同期対象から除外する。既存予約は UID 消失と同様にキャンセルされる。
- 清掃リストの関連予約にキャンセル条件がなかった。キャンセル・ブロック・無効化済みタスクを除外。参照できない関連予約は表示しない。予約なしの正当な手動タスクは保持する。
- 当日到着のみだった予約取得を、当日滞在まで拡張。中日は予約 ID と日付で区別し、未保存なら「未確認」。必要・不要・未確認を日別に保存できる。開始済み・完了済みの要否変更には未完了への復帰が必要。
- 従来トリガーは INSERT / 未割当→割当のみ。新しい清掃トリガーは延長・短縮・退室時刻・部屋・状態に追従する。日付時刻は `AT TIME ZONE 'Asia/Tokyo'` で生成。
- 自動清掃に `cleaning_origin` / `cleaning_date`、要否に `cleaning_requirement`、無効化に `superseded_at` を追加。未完了は ID・担当・日別の要否を保持して更新。不要となった予定を物理削除しない。完了済みの時刻・部屋・ログは変更せず、完了後に出発日が変われば新しい出発日の予定を作る。同じ出発日の再同期で清掃を増やさない。
- 日別保存 RPC は認証済みだけに公開し、既存の `staff_can_access_property` と担当者制約を明示的に適用する。staff に tasks の一般 INSERT 権限は追加しない。DB ガードで未確認・不要の清掃開始やキャンセル後の状態変更を拒否。
- 部屋・タスク画面も無効化済み・未確認・不要を実施対象件数に含めない。清掃画面の保存エラーは表示する。

## 既存データについての重要な制限

既存 tasks には自動／手動の識別子がなく、同じ note を手動で書けるため、文面だけで自動生成と断定できない。
**migration は既存時刻・タスクを更新しない。未分類の既存清掃がある予約では、重複防止のため新しいアウト清掃の自動生成を保留する。既存アウト清掃の日程追従には、下記の個別レビュー・採用が必要。**
キャンセル除外、中日の表示と日別選択は既存予約にも機能する（選択時に必要な日別レコードを限定作成）。

DB の新規既定値は 10:00 に変更するが、既存の 11:00 を変更しない。別経路 `lib/reservations/create-reservation-with-assignment.ts` が明示する 11:00 は今回の OTA 取り込み対象外として変更していない。

## 別途承認が必要な既存データ補正計画

以下は**未実行**。本番への migration、補正、予約更新はいずれも別途承認が必要。

1. バックアップ・復元手順を用意し、通常の OTA 同期・予約編集を止める保守時間を決める。
2. スキーマ適用後、管理者が以下を読み取り専用で実行し、対象 ID と件数を確認する。氏名・電話・メール・iCal URL は出力しない。

```sql
select t.id as task_id, t.reservation_id, t.status, t.assignee_id,
       t.room_id as task_room_id, r.room_id as reservation_room_id,
       t.scheduled_for at time zone 'Asia/Tokyo' as task_time_jst,
       r.check_out_date, r.check_out_time, r.status as reservation_status,
       t.note = 'チェックアウト後の清掃' as matching_old_note
from public.tasks t
join public.reservations r on r.id = t.reservation_id
where t.type = 'cleaning' and t.cleaning_origin is null
order by t.reservation_id, t.scheduled_for, t.id;

select r.status as reservation_status, t.status as task_status,
       count(*) as task_count, count(distinct t.reservation_id) as reservation_count
from public.tasks t join public.reservations r on r.id = t.reservation_id
where t.type = 'cleaning' and t.cleaning_origin is null
group by r.status, t.status order by r.status, t.status;

select reservation_id, count(*) as unclassified_cleaning_count
from public.tasks
where type = 'cleaning' and cleaning_origin is null and reservation_id is not null
group by reservation_id having count(*) > 1;
```

3. 運用記録・作成経緯も照合し、採用する `task_id`、`reservation_id`、自動清掃の種類、業務上の清掃日を承認済み一覧にする。note の一致は候補抽出の参考でしかない。完了済みは履歴を保持し、予定日時からの機械的な日付推定をしない（従来の DB セッション時差の影響があり得る）。手動タスクは採用しない。
4. 承認済み ID のみを別トランザクションで `cleaning_origin='checkout'` と確認済み `cleaning_date` に分類する計画を作る。未完了 checkout は予約ごとに一件に限定。重複候補は担当・完了ログを照合し、削除せず扱いを別途決める。新しい一意制約に合わない状態を一括で押し込まない。
5. 分類が済んだ承認済み予約だけ、同値の `check_out_date` 更新で整合トリガーを実行する計画を作る（予約を先にロックし、タスクを後に更新）。キャンセル分は無効化、現行分は日程・部屋を整合し、必要な中日を未確認で生成。未完了担当・完了ログ・手動タスクを事前スナップショットと比較する。予定件数と実件数を照合し、想定外なら ROLLBACK。
6. 11:00→10:00 のバックフィルはこの計画にも含めない。意図的な時刻変更の証跡がないため、一律変換しない。

補正 SQL の実行用ファイルは、レビュー済み ID が確定してから作成する。今ある migration に無条件の既存データ UPDATE を追加しない。

## 未確定の業務仕様・採用した挙動

- OTA キャンセル後に UID が再出現した場合：現在は自動復活させず、キャンセルを保持。過去分は手動・利用者・OTA の由来を確実に区別できない。選択肢は (A) 常にスタッフが明示的に復活、(B) 将来キャンセル由来を保存し OTA 由来だけ自動復活。今回 A を安全側の暫定動作として採用し、復活 UI や由来移行は未追加。
- 中日の作業開始予定時刻：清掃日を表す仮の 10:00 JST。要否は必ず未確認からスタッフが選択する。時刻を選ぶ UI は対象外。
- 完了済み清掃と同じ出発日で部屋・時刻のみ変わっても、完了履歴を移動・再作成しない。別日への延長は新しいアウト清掃を作る。同日でも追加清掃が必要な運用は手動判断。
- prep / key_setup / special_check の日程追従は今回の対象外。元の生成動作を保ち、時差指定とキャンセル・ブロック新規生成防止のみ共通関数内で修正。

## 導入順と切戻し

追加の権限・競合修正・接続阻害・旧版混在の扱いは `housekeeping-production-preflight.md` を先に参照する。

1. 上記未確定仕様と既存補正計画を確認・承認。
2. 本番同等のステージングへバックアップ復元した検証環境で RLS / PostgREST / セッション認証を含めて追加 E2E を行う。
3. 別途承認後、DB migration を先に適用。既存分を使う場合は承認済み分類・整合も保守時間内に実行。新コードは追加カラム・RPC を使うため DB より先に公開しない。
4. アプリをデプロイし、認証スタッフで清掃要否の保存・再表示・担当・キャンセル除外を確認。実 OTA 同期は別途承認された保守操作としてのみ再開。
5. アプリだけ旧版に戻すと旧同期がキャンセルや時刻を上書きするため、切戻し時は同期を止める。追加列・完了履歴は削除しない。逆 migration の自動実行は用意していない。

## 検証方法と限界

- `node --test tests/housekeeping.test.mjs`：実際の同期・パーサー・ページ・React を読み込み、通信 / Supabase / navigation をモック化。実 OTA に通信しない。
- `bash tests/run-housekeeping-db.sh`：PostgreSQL 17 の使い捨てコンテナを `--network none`、ポート公開なしで作成。auth schema / roles / uid の最小シム、既存 34 本と新規 1 本の migration を順に適用し、SQL 検証後にコンテナを削除。RLS・実トリガー・一意制約を検証。Supabase Auth / PostgREST 自体は起動していない。
- `npm install --prefix /tmp/hotelpg-browser-tools --cache /tmp/hotelpg-npm-cache --ignore-scripts @playwright/test esbuild` の後、`HOTELPG_TEST_TOOLS=/tmp/hotelpg-browser-tools node tests/browser-housekeeping.mjs`：既存 Chromium を使い実 Board を描画。保存先はブラウザの合成データ、外部通信は遮断。認証済み Next Server Action→実 DB の E2E ではない。スクリーンショットは git 対象外の `test-artifacts/` に生成。
- lint / TypeScript / production build は既存 node_modules の CLI を直接実行。環境の pnpm ラッパーはホーム領域への書込みで失敗したため、同じインストール済み CLI に切り替えた。アプリ変更で失敗したものではない。
- 実サービスでの競合負荷テスト、実 OTA、メール・通知・決済、共有／本番 migration は未実施。
