# Supabase 事前確認：1回の実行・1ファイルの結果

前回と同じ **hotelpg-saas / main PRODUCTION** の SQL Editor で、`housekeeping-preflight-json.sql` の全文を貼り付け、一度だけ実行する。出力は `housekeeping_preflight` という1列・1行の JSON。結果を **JSON または CSV のどちらか一方**でエクスポートすればよい。複数の結果タブやスクリーンショットは不要。

SQL はカタログの読取りだけで、予約・清掃・staff の実データは読み取らない。DB の変更やアプリ関数の実行はしない。確認対象は必要カラムと既定値、制約、索引、トリガー、関数 owner／SECURITY属性、アプリロール・実効 EXECUTE／テーブル権限、RLS とポリシー。

関数本文・設定値は出力しない。式に含まれる引用文字列は `[literal]` に置換し、定義の照合用フィンガープリントを付ける。個人情報やキーを取得する操作は含まない。関数のプロパティ検査・フィンガープリントだけで意味上の安全性を証明できるものではないため、レビュー済み定義との照合も行う。

`history.table_exists=false` は履歴表がないことだけを示す。migration 未適用とは判断しない。オブジェクト欠落は `exists=false`、存在しないロールの権限は `null` として返す。DB名から Supabase の project ref は推測しない。

隔離 PostgreSQL 17 で、空スキーマ・既存34 migration後・新規 migration後を検証した。いずれも履歴表なしで1行JSONを返し、11:00／10:00の既定値、RPCの authenticated 許可／anon 拒否、存在しない authenticator ロールを確認。RLS式と関数設定へ挿入した検証用の秘密文字列が結果に含まれないことも確認済み。本番DBでの実行はしていない。
