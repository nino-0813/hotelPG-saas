# 本番反映前の確認と承認待ち事項

2026-10-14。**本番 DB、main、Production は未変更。** 本番反映の依頼は受領しているが、親から DB 適用の明示返答を待つ指示があるため実行しない。

## 現在の確認結果

- リモート main は `7e243a87ee75094f32c2acf7d290b0222c5e9d2c`。最初の修正 Preview は `75c9dcfc8958cae2b561ce0dd513b951eaa6972f`。この後にロック・メタデータ保護の追加修正があるため、75c9dcf を本番へ昇格しない。
- Vercel MCP の project 取得で SaaS 名 `hotel-pg-saas`、project ID `prj_Ksu7fwYJlEHZfThzsYgUO8bCTXQu`、team ID `team_NiV5DuvgED8FKWdR8hVZeHwP` を確認。対象チームの deployments 一覧は 403。CLI は未インストール、CLI 用の既存認証も今回の環境にはない。Production の実デプロイをこちらでは独立検証できていない（親の視認では main=Production、75c9dcf=Ready Preview）。
- 実行環境にあるのは Supabase の公開 URL と anon key のみ。キー値は表示・ファイル保存していない。DB パスワード、DB 接続 URI、Supabase 管理 API token、リンク済み Supabase CLI 設定はない。anon key はスキーマ変更用権限ではない。
- 公開接続先 `loqkgiqnrfrlahampqrt.supabase.co` の既存／必要カラムを `select ... limit=0` で読取り確認しようとしたが、通常・許可された追加ネットワーク経路とも接続に失敗。**本番 DB とこの公開接続先の一致、既存 migration 適用状況、新カラム／RPC の有無は未確認。** 接続失敗を「カラムなし」と解釈していない。
- 新しい秘密情報の取得、token 発行、アプリ再接続、権限付与、環境変数の pull はしていない。

## migration の変更内容と必要権限

`20261014000001_housekeeping_reconciliation.sql` は以下を行う。

1. reservations の新規 `check_out_time` 既定値を 10:00 に変更。
2. tasks に由来・業務日・要否・無効化日時の 4 カラム、CHECK 制約、重複防止の部分 UNIQUE INDEX を追加。
3. 元の自動タスク生成関数を置き換え、清掃を独立した予約整合トリガーへ分離。prep/key 等の生成は維持し、JST 時刻を明示。
4. 予約変化に追従する SECURITY DEFINER トリガー関数、日別の限定 SECURITY DEFINER RPC、状態ガード、SECURITY INVOKER のメタデータ保護トリガーを追加。
5. 日別 RPC の PUBLIC EXECUTE を取り消し、authenticated へ EXECUTE を付与。

即時の予約／タスク UPDATE、DELETE、INSERT、バックフィルはない。関数本文中の更新は、**適用後に予約操作や日別選択が起きたとき**に実行される。既存値の書換えがないことは隔離 DB で確認済み。ALTER TABLE / INDEX 作成はテーブルロックを取り得るため、無停止・無影響とは断定しない。対象規模／長時間トランザクションを確認し、保守時間に `lock_timeout` / `statement_timeout` を設定した一括トランザクションで適用する計画が必要。

既に同名 migration や追加カラムが存在する場合、このファイルをそのまま再実行しない。旧75c9dcf版の関数が適用済みなら、差分修正用 migration を別途レビューして準備する。適用履歴だけでなく関数の定義・SECURITY属性も照合する。

必要なのは対象 SaaS DB のテーブル・関数・トリガーを変更できる既存の正規 owner/migration ロール（例：プロジェクト管理者の Supabase SQL Editor）。anon key や通常の authenticated セッションでは適用できない。新たな広範囲ロールを付与する必要はない。

## 追加される実効権限（明示的な承認対象）

既存 staff には tasks の一般 INSERT policy がない。今回の RPC により、**条件を満たす staff が中日の自動清掃タスク一件を限定作成できる**ようになる。RLS を緩和していなくても、これは能力の追加であり、単なる既存 UPDATE と同一ではない。

- 呼出し対象：authenticated。実際の実行時に staff テーブルの admin/staff ロールと物件権限を検査。anon、staff 行のない利用者は拒否。
- 操作：指定した予約 ID と中日の日付について、未確認／必要／不要を保存。必要なら当該予約・部屋・日に限定した task を一件生成する。任意の部屋、予約外日付、担当者、完了状態、他の task type をパラメータに指定できない。
- 境界：既存 `staff_can_access_property` を使用。admin は全物件、staff は assigned_property_ids の範囲。**空の assigned_property_ids は既存仕様通り全物件許可**。別の tenant_id 境界を新設したものではない。
- 担当制約：staff は未割当または自分担当だけ。admin は担当に関係なく操作可能。ただし開始済み／完了済みの要否変更は admin も拒否し、正規の未完了復帰を先に行う。
- 予約制約：有効・割当済み予約の check_in_date より後、check_out_date より前だけ。キャンセル／ブロック、到着日、出発日、日付範囲外は拒否。
- 一般 INSERT policy や他テーブルの権限は追加しない。
- 新規のメタデータ保護：authenticated / anon / service_role からの直接操作では由来・業務日・無効化情報を変更できない。自動生成行の予約・部屋・種類・ID・予定日時・状態変化を伴わない完了日時の改変も拒否。staff の手動行の部屋・予約・種類・ID変更も拒否し、既存 UPDATE policy の宛先物件チェック不足を経由して境界を越えないようにする。
- 管理者の既存手動タスクの部屋・日時・注記・優先度編集は維持。管理者が自動タスクの日時・部屋を変える場合は予約編集を使う。明示承認された legacy 分類はアプリ API ではなく DB owner の管理作業とする。
- SECURITY INVOKER のメタデータガードは直接呼出しロールを検査する。予約トリガーと限定 RPC の内部は関数 owner として実行され、正規のメタデータ保守だけが可能。RPC 自身の予約・物件・担当チェックは維持する。

## 独立レビュー所見の再現・修正

旧75c9dcfの migration と実 PostgreSQL で、次を再現した。

- 予約→task と task→予約 FOR SHARE の逆順による `40P01`：キャンセル、短縮、部屋移動、日別要否 RPC との競合4ケース。
- authenticated staff が cleaning_origin を NULL にしてから未確認 task を開始する回避。

修正では状態ガードの予約読取りから FOR SHARE を除去した。task の行ロックは通常 UPDATE が保持し、重なった予約更新はその解放後に整合する。ガードはその時点でコミット済みの予約状態を読む。競合時の清掃操作が必ずエラーになるという保証ではなく、清掃変更が先に完了し、続く予約変更が最終予定を確定する順序も有効とする。既に無効化済みなら状態ガードで拒否する。日別 RPC は予約→task の順序を維持し、競合相手が先に開始した場合は業務エラーとして要否変更を拒否する。

実 authenticated staff による競合テストと、由来消去・種類変更・予約切離し・業務日改変・別物件移動・完了日時改変・複合変更を含む権限テストを追加。`tests/run-housekeeping-db.sh` で通常の DB 回帰テストに続けて実行する。

## 利用開始の最小手順と必要な人の操作

1. 親／管理者が対象 Supabase プロジェクトと正規 SQL 実行者を確認する。秘密をチャットに貼る必要はない。既存 SQL Editor で `docs/housekeeping-preflight-json.sql` の全文を一度だけ読み取り実行し、1行のJSON結果をJSONまたはCSVでエクスポートする。これにより、カラム・関数・権限・トリガーの結果をまとめて確認できる。これが現在の最小接続操作。Vercel の検証には対象チームの既存接続を権限のある利用者が再接続するか、管理画面で Production の SHA を確認する。
2. 上記 RPC の実効権限追加とメタデータ制約を承認し、DB 適用可否を明示する。既存データ補正はこの承認に含めない。
3. 実 Supabase Auth / PostgREST を含むステージング E2E を最終SHAで実施。これは引き続き未実施であり、本番をテスト予約・清掃状態の書込みで代用しない。
4. スタッフの清掃・予約操作と iCal 同期（定期実行がある場合はそれも）を保守時間だけ停止する。**DB 先行適用直後は旧 UI が未確認／不要の新 task を実施対象として扱う可能性があり、旧同期は状態・時刻を上書きするため、混在したまま運用しない。** 停止方法は現行運用管理者が確認する。今回勝手に予約や enabled 設定を変更しない。
5. DB を先に適用してカラム・関数 owner・EXECUTE・トリガー・適用履歴を読み取り確認。その後だけ対象コミットを main に取り込み、通常の GitHub→Vercel Production が Ready になるまで利用を再開しない。Preview75c9dcfの単純昇格はしない。
6. Production の実 SHA・認証／清掃画面読取り・エラー状況を確認して再開。新規／識別済み自動タスクと中日選択を利用できる。既存未分類アウト清掃は無断で採用せず、手動・自動の承認済み ID による別補正まで日程追従が未適用であることを担当者に伝える。全既存清掃が補正済みと宣言しない。

## 中止・切戻し

DB migration は適用前にスナップショット／復旧手順を確認し、一括トランザクションで失敗時 ROLLBACK する。適用成功後にアプリ公開が失敗した場合、利用・同期停止を継続する。**旧アプリ単独 rollback は安全ではない。** 旧UIと新DBの混在や旧同期の再上書きがあるため、復旧判断を別途行う。新しい日別決定・完了履歴を無条件に削除する down migration は実行しない。追加修正の production 適用、権限変更、legacy adoption は本書作成時点で未実施。
