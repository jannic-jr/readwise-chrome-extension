# Readwise Chrome Extension for Amazon.co.jp

KindleハイライトをReadwiseに同期するChrome拡張機能（Amazon.co.jp対応版）

## 主な機能

- Amazon.co.jpのKindleノートブックページからハイライトを自動取得
- Readwise API v2を使用してハイライトを同期
- 日本語書籍のタイトル・著者名を正しく認識
- 重複同期の防止機能

## 修正内容

このバージョンでは以下の修正を行いました：

### Readwise API v2対応
- 古い`/async_bd/`エンドポイントから`/api/v2/highlights/`に変更
- 認証方法を`Authorization: Token XXX`ヘッダーに変更
- データ形式を`highlights`配列に変更
- `location`フィールドを整数（順序番号）に修正

### エラー修正
- 400エラー「A valid integer is required.」を解決
- 500エラーのリトライ機能を追加
- ハイライト取得の安定性を向上

## インストール方法

1. **コードをダウンロード**
   ```bash
   git clone https://github.com/jannic-jr/readwise-chrome-extension.git
   ```

2. **Chrome拡張機能のデベロッパーモードを有効化**
   - [拡張機能のページ](chrome://extensions/)を開く
   - 右上の「デベロッパーモード」をONにする

3. **拡張機能を読み込み**
   - 「パッケージ化されていない拡張機能を読み込む」をクリック
   - ダウンロードしたフォルダを選択

4. **Readwiseで認証**
   - 拡張機能をインストール後、Readwiseでログイン
   - アクセストークンを取得

5. **Kindleページで同期**
   - https://read.amazon.co.jp/kp/notebook?ft にアクセス
   - 自動的に同期が開始されます

## 使用方法

1. Amazon.co.jpにログイン
2. Kindleのノートブックページにアクセス
3. 拡張機能が自動的にハイライトを検出・同期
4. Readwiseでハイライトを確認

## 注意事項

- この拡張機能は非公式です
- Amazon.co.jpの仕様変更により動作しなくなる可能性があります
- 個人利用を想定しています

## 技術仕様

- Manifest V3対応
- Readwise API v2使用
- 日本語文字エンコーディング対応
- エラーハンドリング強化

## ライセンス

このプロジェクトは元のReadwise Chrome拡張機能をベースに、Amazon.co.jp対応の修正を加えたものです。