<div align="center">

<img src="store/edge/logo-300.png" width="104" height="104" alt="MARGIN アイコン" />

<h1>MARGIN</h1>

<p><strong>Bilibili をもっと見やすく。</strong></p>
<p>すっきりとしたレイアウト、リキッドグラスのコントロール、アニメーション背景を、ネイティブの再生体験そのままに。</p>
<p>A quieter interface for Bilibili, with clean layouts, liquid glass controls and animated backgrounds.</p>

<p>
  <a href="https://github.com/jiuyang5354/bilibili-margin/releases/latest"><img src="https://img.shields.io/github/v/release/jiuyang5354/bilibili-margin?display_name=release&amp;label=version&amp;color=00aeec" alt="最新バージョン" /></a>
  <a href="https://addons.mozilla.org/en-US/firefox/addon/%E6%98%A0%E9%97%B4-margin/"><img src="https://img.shields.io/amo/v/margin@jiuyang5354.github.io?label=Firefox%20Add-ons&amp;color=ff7139" alt="Firefox アドオン" /></a>
  <img src="https://img.shields.io/badge/browser-Edge%20%2F%20Chrome%20%2F%20Firefox-535b66" alt="Edge、Chrome、Firefox 対応" />
  <img src="https://img.shields.io/badge/extension-Manifest%20V3-535b66" alt="Manifest V3" />
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-535b66" alt="MIT ライセンス" /></a>
</p>

<p>
  <a href="https://github.com/jiuyang5354/bilibili-margin/releases/latest">ダウンロード</a> ·
  <a href="#クイックスタート">クイックスタート</a> ·
  <a href="#機能">機能</a> ·
  <a href="#よくある質問">よくある質問</a> ·
  <a href="CHANGELOG.en.md">更新履歴</a> ·
  <a href="https://github.com/jiuyang5354/bilibili-margin/issues">問題を報告</a>
</p>

<p><a href="README.md">简体中文</a> | <a href="README.en.md">English</a> | <strong>日本語</strong></p>

</div>

> **MARGIN について**
>
> Bilibili のホーム、検索、動画、記事の各ページ向けの、オープンソースの Edge / Chrome / Firefox 拡張機能です。ネイティブのプレイヤー、弾幕、コメントはそのままに、テーマ、フィルター、お気に入りのショートカット、ローカルの利用履歴ヒートマップを追加します。設定と利用記録はお使いのデバイス上に保存され、天気機能はサードパーティの位置情報・予報サービスを利用します。

## プレビュー

| 浅色のホーム | 暗色のホーム |
| :---: | :---: |
| ![浅色テーマでの推薦フィードと利用履歴ヒートマップ](store/edge/screenshots/1.png) | ![暗色テーマでの推薦フィードとアニメーション背景](store/edge/screenshots/2.png) |

<details>
<summary>プレイヤー、コマンドパレット、お気に入り、検索を見る</summary>

| 動画ページ | コマンドパレット |
| :---: | :---: |
| ![Bilibili のネイティブプレイヤーを使った動画ページ](store/edge/screenshots/3.png) | ![検索候補とコマンド](store/edge/screenshots/4.png) |

| お気に入り | 検索 |
| :---: | :---: |
| ![グラスフォルダーのお気に入りドロワー](store/edge/screenshots/5.png) | ![刷新された検索結果](store/edge/screenshots/6.png) |

</details>

スクリーンショットは主な画面を示すものであり、細部は現在のバージョンと異なる場合があります。

## クイックスタート

1. [最新リリース](https://github.com/jiuyang5354/bilibili-margin/releases/latest)から [`margin.zip`](https://github.com/jiuyang5354/bilibili-margin/releases/latest/download/margin.zip) をダウンロードし、恒久的に保存するフォルダーに展開します。
2. `edge://extensions` または `chrome://extensions` を開き、**Developer mode** を有効にします。
3. **Load unpacked** を選び、`manifest.json` が含まれるフォルダーを選択します。
4. [Bilibili](https://www.bilibili.com/) を開く、または再読み込みします。

手動インストールを更新するには、展開したファイルを置き換え、拡張機能の管理ページで **Reload** をクリックしてから Bilibili を再読み込みします。リリースの詳細は[更新履歴](CHANGELOG.en.md)を参照してください。

**Firefox（140 以降）**：[Firefox アドオンからインストール](https://addons.mozilla.org/en-US/firefox/addon/%E6%98%A0%E9%97%B4-margin/)するのがおすすめです（恒久的にインストールされ、自動更新されます）。代替手段として、[`margin-firefox.zip`](https://github.com/jiuyang5354/bilibili-margin/releases/latest/download/margin-firefox.zip)（直接リンク、常に最新版）をダウンロードし、`about:debugging#/runtime/this-firefox` を開いて **Load Temporary Add-on** を選び、zip を選択します。一時的なアドオンは Firefox を再起動すると削除されます。

その他の Chromium 系ブラウザ（Brave、Opera、Vivaldi、Arc など）は Chrome の手順に従えますが、個別の動作確認は行っていません。Safari には現在対応していません。

## 機能

| 領域 | 内容 |
| --- | --- |
| ホームと検索 | パーソナライズされた推薦、人気動画、無限スクロール、更新、そしてキーワード・投稿者・再生数・再生時間によるフィルター。 |
| ネイティブ再生 | タイトル、投稿者カード、エピソード一覧、推薦を刷新しつつ、ネイティブのプレイヤー、弾幕、コメント、画質、全画面のコントロールを維持します。 |
| リスニングモード | 動画ページでヘッドホンのショートカットを開くと、動画/弾幕とカバー/歌詞の表示を切り替え、リアルタイムのスペクトラムや波形を表示し、字幕やローカルの歌詞を使い、ホーム背景の設定を共有できます。 |
| 弾幕エアボーン | 任意機能で既定ではオフ。時刻に言及する弾幕（「03:20」や「2:15 にジャンプ」など）に下線が付きます。クリックするとシークでき、取り消しも可能です。すべてお使いのデバイス上で解析され、ネットワークリクエストは発生しません。 |
| お気に入りとあとで見る | グラスフォルダーのカード、あとで見るリスト、視聴の進捗、動画のコンテキストメニュー。 |
| 利用履歴 | 年間・月間のヒートマップ、初回起動時刻と日々の利用状況、視聴履歴のバックフィル、データソースのラベル。 |
| 記事とアカウントのページ | 投稿、オーパス記事、コラム向けの読みやすいレイアウトに加え、スペース、履歴、フィード、メッセージに合わせた画面。プライベートチャットでは画像のプレビュー/送信と、Bilibili ネイティブの絵文字選択に対応します。 |
| 外観 | ライト・ダーク・システムのテーマ、13 種類のアニメーション背景、カスタム画像と強度のコントロール（Gateway flow やクリック時の衝撃波を含む）。 |
| ショートカット | 検索候補、コマンドパレット、ホバープレビュー、めくれるプロフィールカード、都市を編集できる天気ウィジェット。 |
| ローカルデータ | 設定と利用記録をローカルに保存し、JSON のインポート・エクスポートに対応。 |

一部のアカウント機能には Bilibili へのログインが必要です。利用可否は Bilibili の API、権限、地域制限にも左右されます。

リスニングモードは初回使用時に読み込まれ、再生中に音声解析を開始します。歌詞は、読み込まれたプレイヤーの字幕、インポートした LRC/テキストファイル、または元の動画画像から取得できます。再生に戻るコントロールを選ぶか、Esc を押すと終了します。

## よくある質問

### 元のインターフェースに戻すには？

ヘッダーメニューで元のページに戻すオプションを選ぶか、ページの URL に `?margin=off` を追加します。MARGIN のポップアップから無効にすることもできます。

### MARGIN はプレイヤーを置き換えたり、アカウントを変更したりしますか？

再生は Bilibili のネイティブプレイヤーが担います。MARGIN は現在の Bilibili セッションを使ってページデータを取得し、お気に入りやあとで見るの操作も引き続き Bilibili の API を利用します。

### 自動的に更新されますか？

手動で読み込んだ拡張機能には上記の更新手順が必要です。ポップアップは GitHub の新しいリリースを確認します。Edge アドオンからインストールした場合は、承認された更新がブラウザー経由で配信されます。

### 背景はアニメーションし続けますか？

GPU アクセラレーションが有効な表示中のページでは、スクロール中、動画の再生中、ドロワーを開いている間も背景はアニメーションし続けます。非表示のタブでは一時停止し、reduced-motion の設定を尊重します。ソフトウェアレンダリングでは、ページの速度低下を避けるために静止状態を保つセーフガードが働きます。起動アニメーションの間は、その下に隠れる背景を一時的に停止します。レンダリングはデバイスとページの読み込み状況に合わせて調整され、あらゆる状況で一定の 60fps が保証されるわけではありません。[パフォーマンスに関するメモ](docs/performance-v0.31.0.md)を参照してください。

## プライバシー

0.6.4 から、任意の外部サービスと最近の検索の保存は、設定 → プライバシーで既定でオフになっています。外部サービスを許可すると、天気、コミュニティのスポンサーデータ、手動の更新チェックが有効になります。オプトインした検索は拡張機能のストレージに保持され、最大 8 件まで、30 日で期限切れとなり、読み込み時にクリーンアップされます。アプリフィードの認証情報は、既定では現在のブラウザーセッションにのみ保存されます。「認証を記憶」を有効にすると、この端末に最長 30 日間保存されます。Bilibili 側の有効期限が先に切れる場合は、その期限までです。

コミュニティによる広告スキップは既定でオフです。有効にすると、4 文字の BVID ハッシュの先頭を使って [BilibiliSponsorBlock](https://bsbsb.top/) に問い合わせ、通常の BV 動画でマークされたスポンサー区間をスキップします（取り消し可能）。Bilibili の Cookie、アカウント識別子、完全な動画 ID をそのサービスに送信することはなく、Bilibili の完走メトリクスを保証するものではありません。

開発者は分析用やデータ収集用のサーバーを運用していません。設定、利用記録、カスタム背景画像はお使いのデバイス上に保持され、エクスポートしたバックアップはご自身で保管してください。

天気のリクエストは、おおよその都市を特定するために `ipwho.is` を使用します。対応している中国の都市では、国家気象センター（`www.nmc.cn`）の観測値と日次予報を優先し、利用できない時間別予報や降水確率は省略されます。海外の都市や利用できない国内データには Open-Meteo を使用します。各プロバイダーが受け取るのは、それらのリクエストに必要な IP、都市、観測所コード、座標のみです。Bilibili のアカウント情報、お気に入り、視聴履歴が天気プロバイダーに送信されることはありません。[プライバシーポリシー](PRIVACY.md)をご覧ください。

MARGIN は独立したオープンソースプロジェクトであり、**Bilibili の公式製品ではなく、Bilibili とは提携していません**。

## 開発とコントリビュート

依存関係のインストールとビルドには Node.js 22 と pnpm を使用します：

```bash
corepack enable
pnpm install --frozen-lockfile
pnpm run build
```

`dist/` を展開済みの拡張機能として読み込みます。`zip` コマンドが使える環境では、`pnpm run pack` で `margin.zip` が作成されます。

このプロジェクトはネイティブの TypeScript、CSS、Shadow DOM を使用しています。Vite がページモジュールをルートごとに分割し、バックグラウンドの Service Worker が利用タイミングを集約し、中国語フォントは文字範囲ごとに分割されています。

[Issue と提案](https://github.com/jiuyang5354/bilibili-margin/issues)を歓迎します。ページの URL、再現手順、インターフェース変更の場合はスクリーンショットを添えてください。また、動画ページを変更する際はネイティブ再生を維持してください。サードパーティのクレジットについては[デザインリファレンスとクレジット](docs/design-references.en.md)を参照してください。

## ライセンス

[MIT License](LICENSE) © 2026 jiuyang5354. サードパーティのコンポーネント、フォント、アセットはそれぞれの規約に従います。[デザインリファレンスとクレジット](docs/design-references.en.md)と[フォントのライセンス](public/fonts/FONTS-LICENSES.md)を参照してください。
