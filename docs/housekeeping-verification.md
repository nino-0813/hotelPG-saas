# 清掃・取り込み修正の検証記録

2026-10-14、ローカル隔離環境。基点 `7e243a87ee75094f32c2acf7d290b0222c5e9d2c`。

| 検証 | 結果・対象 |
| --- | --- |
| Node テスト | 16 / 16 成功。実パーサー・同期・ページ・Server Action・React を使用し、外部 I/O をモック化 |
| PostgreSQL 17 | 41 項目成功。`--network none`、ポート公開なし、全 35 migration を適用。既存タスク・時刻の無変更も確認 |
| Chromium | 実 Board を合成データで描画。1280px / 390px。未確認→必要→不要→未確認、再読込保持、開始→未完了、完了→未完了、横スクロールなし、JS エラーなし |
| ESLint | エラー 0、警告 3（すべて基点にも存在する未使用変数）。追加の lint 失敗なし |
| TypeScript | `tsc --noEmit` 成功。基点も成功 |
| Next production build | `next build` 成功（最終コード）。Turbopack、Next 16.2.4 |
| Diff | `git diff --check` 成功 |

既存 lint 警告：`rooms/room-status-board.tsx: openTaskCount`、`tasks/page.tsx: RoomType`、`tasks/task-list.tsx: Fragment`。
環境の pnpm ラッパーは書込み不可のホーム領域を使って失敗したため、インストール済み CLI を直接実行した。

## 要件別カバレッジ

- 手動・利用者リンク・OTA キャンセル状態、キャンセル UID の再登場、同期中のキャンセル、OTA の UID 消失／STATUS:CANCELLED。
- 新規 10:00、既存の意図的な 12:30 / 17:00・滞在状態の保持、DB 初期値、既存時刻の migration 無変更。
- 3 泊の到着・2 中日・出発、同日入替、同名の別予約の分離、JST 日付境界の開始を含む／終了を含まない条件。
- 未確認表示、必要・不要・未確認の保存／変更／再表示、未確認・不要の開始拒否、作業開始・完了後の要否保護、担当者／物件範囲の権限、匿名 RPC 拒否。
- 延長・短縮・部屋変更・アウト時刻変更・未割当→割当・再割当、タスク ID／担当保持、完了内容／ログ保持、手動タスク保持、重複防止。
- 完了済みアウト清掃を維持したまま、別日への延長で新しいアウト清掃を一件生成。
- UTC / America/Los_Angeles の DB セッションでも JST 時刻生成。
- 未分類の既存タスクを推測して書換えず、重複アウト清掃の生成を保留。未処理の既存滞在にもスタッフ選択で日別タスクを作成。
- 物理削除の cascade とキャンセル時の履歴保持の区別。
- クエリ・部分同期・保存失敗を成功／空リストとして扱わない。

## 成果物と再実行

- `tests/housekeeping.test.mjs`：`node --test tests/housekeeping.test.mjs`
- `tests/run-housekeeping-db.sh` と `tests/housekeeping-db.sql`：`bash tests/run-housekeeping-db.sh`
- `tests/browser-housekeeping.mjs`：ツールの一時インストール手順は rollout 文書参照。
- スクリーンショット（合成データ、git 対象外）：`test-artifacts/housekeeping-required-desktop.png`、`test-artifacts/housekeeping-unconfirmed-mobile.png`。
- 詳細な既存データ抽出 SQL・補正計画・導入順・未確定仕様：`docs/housekeeping-rollout.md`。

## 未検証の範囲

実 Supabase Auth / PostgREST / 認証済み Next Server Action / DB をつないだ E2E は未実施。DB は実 PostgreSQL と認証シム、ブラウザの保存はモック。実 OTA、利用者の実キャンセル URL、通知・メール、決済、共有／本番 DB、デプロイは操作していない。導入前のステージング E2E は必要。

既存自動タスクには識別情報がないため、**既存アウト清掃の日程追従を有効にする補正は未実施**。レビュー済み ID に限定して別途承認後に行う。これをしない状態で全既存予約の清掃予定が補正済みとはみなさない。

## 変更ファイル一覧

- `.gitignore`
- `package.json`
- `app/(dashboard)/housekeeping/actions.ts`
- `app/(dashboard)/housekeeping/housekeeping-board.tsx`
- `app/(dashboard)/housekeeping/page.tsx`
- `app/(dashboard)/rooms/page.tsx`
- `app/(dashboard)/tasks/page.tsx`
- `lib/housekeeping.ts`
- `lib/ical/parse-vevents.ts`
- `lib/ical/parse.ts`
- `lib/ical/sync.ts`
- `supabase/migrations/20261014000001_housekeeping_reconciliation.sql`
- `tests/housekeeping.test.mjs`
- `tests/housekeeping-db.sql`
- `tests/run-housekeeping-db.sh`
- `tests/browser-housekeeping.mjs`
- `docs/housekeeping-rollout.md`
- `docs/housekeeping-verification.md`
