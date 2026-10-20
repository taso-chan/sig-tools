// SIG在庫引きツール（sig-platform の上でブックマークから起動）
// 商品名と個数の一覧を受け取り、浅草橋の在庫を「手動変更」で減らす／増やす（カテゴリ在庫画面の「削減」「追加」と同じ送信）。
(function () {
  'use strict';
  var LOCATION_ID = '3'; // 浅草橋
  var PANEL_ID = 'sig-stock-out-panel';
  var VERSION = '10/20-B'; // 直したら更新する（小窓のタイトルに出して、新しい版か見分ける）

  if (location.hostname !== 'sig-platform.com') {
    alert('sig-platform.com にログインした画面で押してください。');
    return;
  }
  var old = document.getElementById(PANEL_ID);
  if (old) old.remove();

  // ---------- 画面 ----------
  var panel = document.createElement('div');
  panel.id = PANEL_ID;
  panel.innerHTML =
    '<style>' +
    '#' + PANEL_ID + '{position:fixed;top:12px;right:12px;width:640px;max-height:calc(100vh - 24px);overflow:auto;z-index:2147483647;background:#fff;color:#222;border:2px solid #1565c0;border-radius:10px;box-shadow:0 8px 30px rgba(0,0,0,.25);font:13px/1.5 sans-serif;padding:14px}' +
    '#' + PANEL_ID + ' h2{margin:-14px -14px 8px;padding:10px 14px;font-size:16px;color:#1565c0;background:#e3f2fd;border-radius:8px 8px 0 0;cursor:move;user-select:none}' +
    '#' + PANEL_ID + ' h2 small{font-weight:normal;font-size:11px;color:#666;margin-left:8px}' +
    '#' + PANEL_ID + ' button{font:inherit;padding:6px 12px;border-radius:6px;border:1px solid #999;background:#f5f5f5;cursor:pointer}' +
    '#' + PANEL_ID + ' button.go{background:#1565c0;color:#fff;border-color:#1565c0;font-weight:bold}' +
    '#' + PANEL_ID + ' button:disabled{opacity:.4;cursor:default}' +
    '#' + PANEL_ID + ' .x{position:absolute;top:8px;right:10px;border:none;background:none;font-size:18px}' +
    '#' + PANEL_ID + ' textarea{width:100%;box-sizing:border-box;height:140px;font:13px/1.5 monospace}' +
    '#' + PANEL_ID + ' select{max-width:100%;font:inherit}' +
    '#' + PANEL_ID + ' .box{border:1px solid #ddd;border-radius:6px;padding:8px;margin:8px 0;background:#fafafa}' +
    '#' + PANEL_ID + ' .ng{color:#c62828}#' + PANEL_ID + ' .ok{color:#2e7d32}#' + PANEL_ID + ' .info{color:#8a6d00}' +
    '#' + PANEL_ID + ' table{border-collapse:collapse;width:100%;font-size:12px}' +
    '#' + PANEL_ID + ' td,#' + PANEL_ID + ' th{border:1px solid #ddd;padding:2px 4px;text-align:left;vertical-align:top}' +
    '#' + PANEL_ID + ' th{background:#eee}#' + PANEL_ID + ' td.n{text-align:right;white-space:nowrap}' +
    '#' + PANEL_ID + ' tr.skip td{background:#fbe9e7}' +
    '</style>' +
    '<button class="x" data-act="close" title="閉じる">×</button>' +
    '<h2 data-role="handle">SIG 在庫引き（浅草橋）<small>' + VERSION + '版・ここをドラッグで移動</small></h2>' +
    '<div>① その日に抜いた商品を1行に1商品ずつ（「商品名 個数」、個数を省くと1個）</div>' +
    '<textarea data-role="input" placeholder="【BOX】アビスアイ 2&#10;【BOX】ニンジャスピナー ×3"></textarea>' +
    '<div style="margin:6px 0">' +
    '<label><input type="radio" name="sig-mode" value="-1" checked> <b>引く</b></label>　' +
    '<label><input type="radio" name="sig-mode" value="1"> <b>足す</b>（戻す・入れ直し）</label>　' +
    '詳細理由：<input type="text" data-role="reason" value="dopa" style="width:120px"> ' +
    '<button data-act="check">照合する</button></div>' +
    '<div data-role="status"></div>' +
    '<div data-role="preview"></div>' +
    '<div data-role="run" style="display:none" class="box">' +
    '② チェックした商品の在庫を<span data-role="word"></span>ます <button class="go" data-act="run" data-role="runbtn"></button>' +
    '</div>' +
    '<div data-role="result"></div>';
  document.body.appendChild(panel);

  var $ = function (role) { return panel.querySelector('[data-role="' + role + '"]'); };
  var esc = function (s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); };
  var setStatus = function (html) { $('status').innerHTML = html; };
  var wait = function (ms) { return new Promise(function (r) { setTimeout(r, ms); }); };
  // 全角半角・空白の違いを無視して商品名を比べる
  var norm = function (s) { return String(s || '').normalize('NFKC').replace(/\s+/g, '').toLowerCase(); };
  var num = function (s) { var v = parseInt(String(s || '').replace(/[,\s+]/g, ''), 10); return isNaN(v) ? null : v; };
  var today = function () { return new Date().toLocaleDateString('sv-SE'); };
  // 引く：sign=-1、足す：sign=+1（照合したときの選択で決める）
  var delta = function (it) { return state.sign * it.qty; };
  var signed = function (v) { return (v > 0 ? '+' : '') + v; };

  var state = { items: [], reason: 'dopa', sign: -1, word: '引き', log: [] };

  // ---------- 入力 ----------
  function parseInput(text) {
    var map = {}, list = [];
    text.split(/\r?\n/).forEach(function (raw, i) {
      var line = raw.trim();
      if (!line) return;
      if (/^(午前|午後|朝|昼|夕方?|夜)?の?ピック[:：]?$/.test(line)) return; // 報告の見出し「午前ピック」などは飛ばす
      var name = line, qty = 1, whole = null, m;
      // 「名前<タブ or ,>2」「名前 ×2」「名前 2個」
      if ((m = line.match(/^(.+?)\s*[\t,，]\s*([0-9０-９]+)\s*(?:個|点|箱|枚|BOX)?$/i)) ||
          (m = line.match(/^(.+?)\s*[×xX＊*]\s*([0-9０-９]+)\s*(?:個|点|箱|枚|BOX)?$/)) ||
          (m = line.match(/^(.+?)\s+([0-9０-９]+)\s*(?:個|点|箱|枚|BOX)?$/i))) {
        name = m[1].trim();
        qty = parseInt(m[2].normalize('NFKC'), 10);
        whole = line; // 「iPhone 16」のように末尾の数字が商品名の一部だった場合の予備
      }
      var key = norm(name);
      if (map[key]) { map[key].qty += qty; map[key].lines.push(i + 1); return; }
      map[key] = { lines: [i + 1], input: name, whole: whole, qty: qty, cands: [], pick: null, product: null, why: null, info: null, use: true };
      list.push(map[key]);
    });
    return list;
  }

  // ---------- サイトの読み取り ----------
  function getDoc(url) {
    return fetch(url, { credentials: 'same-origin' }).then(function (r) {
      if (r.redirected && /\/login/.test(r.url)) throw new Error('ログインが切れています。ログインし直してから、もう一度押してください。');
      if (!r.ok) throw new Error('HTTP ' + r.status + '（' + url.split('?')[0] + '）');
      return r.text();
    }).then(function (t) { return new DOMParser().parseFromString(t, 'text/html'); });
  }

  // 全カテゴリ在庫の検索 → [{cat, catName, sub, name, jan, stock}]
  function search(keyword) {
    return getDoc('/admin/category-stocks?location_id=' + LOCATION_ID + '&keyword=' + encodeURIComponent(keyword)).then(function (d) {
      var out = [];
      d.querySelectorAll('main table tbody tr').forEach(function (tr) {
        var a = tr.querySelector('a[href*="/admin/category-stocks/"]');
        var td = tr.children;
        if (!a || td.length < 5) return;
        var cat = (new URL(a.href).pathname.match(/\/admin\/category-stocks\/(\d+)/) || [])[1];
        if (!cat) return;
        out.push({ cat: cat, catName: td[0].textContent.trim(), sub: td[1].textContent.trim(), name: td[2].textContent.trim(), jan: td[3].textContent.trim(), stock: num(td[4].textContent) });
      });
      return out;
    });
  }

  // カテゴリ在庫画面から、その商品の行（「削減」ボタンの data）と、削減・追加の送信フォームを取る
  // 2026-10-20 サイト更新：行ごとの在庫上書きフォームが無くなり、「追加」「削減」の共通モーダル（adjustments/add・reduce）になった
  function getProduct(cat, name) {
    return getDoc('/admin/category-stocks/' + cat + '?location_id=' + LOCATION_ID + '&keyword=' + encodeURIComponent(name)).then(function (d) {
      var hit = [];
      d.querySelectorAll('main table tbody tr').forEach(function (tr) {
        if (!tr.querySelector('[data-stock-reduce-open]') || norm(tr.children[2] && tr.children[2].textContent) !== norm(name)) return;
        hit.push(tr);
      });
      if (hit.length !== 1) throw new Error(hit.length ? '同じ名前の商品が' + hit.length + '件あり、特定できません' : 'カテゴリ在庫画面で商品が見つかりません');
      var tr = hit[0];
      var b = tr.querySelector('[data-stock-reduce-open]');
      var stock = num(b.getAttribute('data-expected-before-stock'));
      if (stock == null) throw new Error('在庫数が読めません');
      var reduce = d.querySelector('form[action$="/adjustments/reduce"]'), add = d.querySelector('form[action$="/adjustments/add"]');
      if (!reduce || !add) throw new Error('在庫の削減・追加フォームが見つかりません（サイトがまた変わった可能性）');
      var cost = tr.querySelector('[data-average-cost-open]');
      return {
        cat: cat, name: tr.children[2].textContent.trim(), jan: tr.children[1].textContent.trim(),
        pid: b.getAttribute('data-product-id'), stock: stock,
        avgCost: cost ? parseFloat(cost.getAttribute('data-average-cost')) || null : null, // 小数あり。未設定なら null
        reduce: reduce, add: add
      };
    });
  }

  // 今日の在庫履歴（全ページ）→ [{date, diff, before, after, reason, detail, user}]
  function historyToday(p) {
    var rows = [];
    function page(n) {
      var url = '/admin/category-stocks/' + p.cat + '?location_id=' + LOCATION_ID + '&history_product_id=' + p.pid +
        '&history_date_from=' + today() + '&history_date_to=' + today() + '&history_page=' + n;
      return getDoc(url).then(function (d) {
        var t = Array.prototype.find.call(d.querySelectorAll('table'), function (t) { return t.textContent.indexOf('変更理由') >= 0; });
        if (!t) return rows;
        // 列は見出しの名前で探す（サイト更新で単価・平均原価などの列が増えて位置が変わったため）
        var head = Array.prototype.map.call(t.querySelectorAll('thead th'), function (th) { return th.textContent.trim(); });
        var ci = {};
        ['変更日', '変更数', '変更前', '変更後', '変更理由', '詳細理由', '担当者'].forEach(function (h) { ci[h] = head.indexOf(h); });
        if (ci['変更数'] < 0 || ci['変更後'] < 0 || ci['変更理由'] < 0 || ci['詳細理由'] < 0) throw new Error('在庫履歴の列が読めません（サイトがまた変わった可能性）');
        var trs = t.querySelectorAll('tbody tr');
        trs.forEach(function (tr) {
          var c = Array.prototype.map.call(tr.children, function (td) { return td.textContent.trim().replace(/\s+/g, ' '); });
          if (c.length < head.length) return;
          rows.push({ date: c[ci['変更日']], diff: num(c[ci['変更数']]), before: num(c[ci['変更前']]), after: num(c[ci['変更後']]), reason: c[ci['変更理由']], detail: c[ci['詳細理由']], user: c[ci['担当者']] });
        });
        var hasNext = !!d.querySelector('a[href*="history_page=' + (n + 1) + '"]');
        return hasNext && n < 20 ? page(n + 1) : rows;
      });
    }
    return page(1);
  }

  function isOurs(h) { return h.reason === '手動変更' && norm(h.detail) === norm(state.reason); }

  // ---------- 略称・種類 ----------
  // 略称 → 正式名（sig-platform の商品名の【】を除いた部分）。ネットで使われている通称を集めたもの。足りなければここに追加する
  // ネット（ショップの商品名・買取表・X・ブログなど）で実際に使われているのを確かめた通称だけ（2026-10-13 調べ）。
  // 照合結果の商品名を必ず確認する。「スタバ」はスターバースの通称だが、Pokémon + STARBUCKS の商品と紛らわしいので入れていない
  var ALIASES = {
    // ポケモン（MEGA・スカーレット&バイオレット）
    'ムニキス': 'ムニキスゼロ', 'ニンスピ': 'ニンジャスピナー',
    'インフェル': 'インフェルノX', 'インフェルX': 'インフェルノX',
    'メガドリ': 'メガドリームex', 'メガブレ': 'メガブレイブ', 'ブレイブ': 'メガブレイブ',
    'メガシン': 'メガシンフォニア', 'シンフォニア': 'メガシンフォニア',
    'ブラボル': 'ブラックボルト', 'ホワフレ': 'ホワイトフレア', 'ホワブレ': 'ホワイトフレア',
    'ロケ団': 'ロケット団の栄光', '熱風': '熱風のアリーナ', 'バトパ': 'バトルパートナーズ',
    'テラフェス': 'テラスタルフェスex', 'テラスタル': 'テラスタルフェスex',
    '超電': '超電ブレイカー', 'ドラゴーナ': '楽園ドラゴーナ',
    'ステミラ': 'ステラミラクル', 'ナイワン': 'ナイトワンダラー', '変幻': '変幻の仮面',
    'クリヘイ': 'クリムゾンヘイズ', 'サイジャ': 'サイバージャッジ',
    'ワイフォ': 'ワイルドフォース', 'ワイフォー': 'ワイルドフォース',
    'シャイトレ': 'シャイニートレジャーex', '未来': '未来の一閃', '古代': '古代の咆哮',
    'レイサフ': 'レイジングサーフ', '黒煙': '黒炎の支配者',
    '151': 'ポケモンカード151', 'イチゴーイチ': 'ポケモンカード151',
    'スノハ': 'スノーハザード', 'クレバ': 'クレイバースト', 'クレイ': 'クレイバースト',
    'トリビ': 'トリプレットビート', 'トリプ': 'トリプレットビート', 'トトト': 'トリプレットビート',
    'バイオ': 'バイオレットex', 'バイオex': 'バイオレットex', 'スカレ': 'スカーレットex',
    // ポケモン（ソード&シールド）
    'ブイユニ': 'VSTARユニバース', 'Vユニ': 'VSTARユニバース',
    'パラトリ': 'パラダイムトリガー', 'アルカナ': '白熱のアルカナ', 'ロスアビ': 'ロストアビス',
    'ポケGO': 'ポケモンGO', 'ダクファン': 'ダークファンタズマ',
    'タイゲ': 'タイムゲイザー', 'タイゲイ': 'タイムゲイザー', 'スペジャ': 'スペースジャグラー',
    'バトリ': 'バトルリージョン', 'Vクラ': 'VMAXクライマックス', 'ブイクラ': 'VMAXクライマックス',
    'フュージョン': 'フュージョンアーツ', '摩天': '摩天パーフェクト', '蒼空': '蒼空ストリーム',
    'イブヒロ': 'イーブイヒーローズ', 'ブイヒ': 'イーブイヒーローズ',
    'ガイスト': '漆黒のガイスト', 'シャイスタ': 'シャイニースターV',
    'ストエメ': 'ストームエメラルダ', 'エメラルダ': 'ストームエメラルダ',
    '25thアニコレ': '25th ANNIVERSARY COLLECTION', '25アニコレ': '25th ANNIVERSARY COLLECTION', 'アニコレ': '25th ANNIVERSARY COLLECTION',
    // ポケモンセンターのスペシャルBOX（午前ピックの報告では「トウホク 47」のように地名だけで来る。2026-10-20）
    'トウホク': 'スペシャルBOX トウホク', '東北': 'スペシャルBOX トウホク',
    'ヒロシマ': 'スペシャルBOX ヒロシマ', '広島': 'スペシャルBOX ヒロシマ',
    'フクオカ': 'スペシャルBOX フクオカ', '福岡': 'スペシャルBOX フクオカ',
    // ワンピース（「OP1」「OP-01」のような番号は下の expand で読み替える）
    'ロマドン': 'OP-01 ロマンスドーン'
  };
  var ALIAS = {};
  Object.keys(ALIASES).forEach(function (k) { ALIAS[norm(k)] = ALIASES[k]; });

  // 「ストエメ」「ストエメ カートン」「アビスアイ 傷」→ 正式名と頭の【】（種類を書かなければ【BOX】）
  function expand(input) {
    var s = input.normalize('NFKC').trim();
    if (/^【/.test(s)) return null; // 【】まで書いてあるなら読み替えない
    var kizu = false, noShrink = false, kind = 'BOX';
    var core = s.split(/\s+/).filter(function (w) {
      if (/^傷(あり|有り|有)?$/.test(w)) { kizu = true; return false; }
      if (/^シュリ(ンク)?(無し|なし|無)$/.test(w)) { noShrink = true; return false; }
      if (/^(カートン|カトン)$/.test(w)) { kind = 'カートン'; return false; }
      if (/^(パック|バラ|バラパック)$/.test(w)) { kind = 'パック'; return false; }
      if (/^(box|ボックス|箱)$/i.test(w)) return false;
      return true;
    }).join(' ');
    var m = core.match(/^(.+?)(box|ボックス|カートン)$/i); // 「ストエメBOX」のようにくっついている
    if (m && ALIAS[norm(m[1])]) { core = m[1]; if (/カートン/.test(m[2])) kind = 'カートン'; }
    if (!core) return null;
    // ワンピースの「OP1」「op01」「EB4」→「OP-01」など（商品名は「OP-01 ロマンスドーン」）
    var op = core.match(/^(op|eb|prb|st)[-\s]?0*(\d{1,2})$/i);
    if (op) core = op[1].toUpperCase() + '-' + ('0' + op[2]).slice(-2);
    var full = ALIAS[norm(core)] || core;
    var prefix = kind === 'カートン' ? (kizu ? '【傷・カートン】' : '【カートン】')
      : kind === 'パック' ? '【パック】'
      : noShrink ? (kizu ? '【傷・シュリンク無しBOX】' : '【シュリンク無しBOX】')
      : (kizu ? '【傷・BOX】' : '【BOX】');
    return { full: full, prefix: prefix };
  }

  // 30th CELEBRATION カードセット（2026-10-16 発売、御三家ごとに 9 種）。「30thセット ヒトカゲ」のように略称＋御三家の1匹で書く
  var CARD_SET_ALIASES = ['30thセット', '30thカードセット', '30thcelebrationカードセット', 'カードセット', '30周年セット', '30周年カードセット'];
  var CARD_SET_TRIOS = [
    ['フシギダネ', 'ヒトカゲ', 'ゼニガメ'], ['チコリータ', 'ヒノアラシ', 'ワニノコ'], ['キモリ', 'アチャモ', 'ミズゴロウ'],
    ['ナエトル', 'ヒコザル', 'ポッチャマ'], ['ツタージャ', 'ポカブ', 'ミジュマル'], ['ハリマロン', 'フォッコ', 'ケロマツ'],
    ['モクロー', 'ニャビー', 'アシマリ'], ['サルノリ', 'ヒバニー', 'メッソン'], ['ニャオハ', 'ホゲータ', 'クワッス']
  ];
  function byCardSet(it) {
    var words = it.input.normalize('NFKC').trim().split(/\s+/);
    if (words.length < 2) return Promise.resolve(null);
    var head = norm(words.slice(0, -1).join('')), mon = norm(words[words.length - 1]);
    if (CARD_SET_ALIASES.map(norm).indexOf(head) < 0) return Promise.resolve(null);
    var trio = CARD_SET_TRIOS.filter(function (t) { return t.map(norm).indexOf(mon) >= 0; })[0];
    if (!trio) return Promise.resolve(null);
    var isSet = function (r) { return norm(r.name).indexOf('30th') >= 0 && norm(r.name).indexOf('カードセット') >= 0; };
    return search('30th CELEBRATION カードセット').then(function (res) {
      return res.filter(isSet).length ? res : search('カードセット');
    }).then(function (res) {
      var sets = res.filter(isSet);
      var hit = sets.filter(function (r) { return trio.some(function (p) { return norm(r.name).indexOf(norm(p)) >= 0; }); });
      if (hit.length === 1) {
        it.info = '「' + it.input + '」→ ' + hit[0].name + ' として扱いました';
        it.cands = sets;
        return [hit[0]];
      }
      return sets.length ? { res: hit.length ? hit : sets } : null;
    });
  }

  // 略称・種類の読み替えで1件に決まれば、それを返す
  function byExpand(it) {
    return byCardSet(it).then(function (r) { return r || byAlias(it); });
  }
  function byAlias(it) {
    var e = expand(it.input);
    if (!e) return Promise.resolve(null);
    return search(e.full).then(function (res) {
      var nf = norm(e.full), np = norm(e.prefix);
      var tries = [
        function (r) { return norm(r.name) === np + nf; },                               // 【BOX】ストームエメラルダ
        function (r) { return norm(r.name).indexOf(np) === 0 && norm(r.name).indexOf(nf) >= 0; }, // 【BOX】…（初回版）など
        function (r) { return norm(r.name) === nf; }                                     // 【】の無い商品
      ];
      for (var i = 0; i < tries.length; i++) {
        var hit = res.filter(tries[i]);
        if (hit.length === 1) {
          it.info = '「' + it.input + '」→ ' + hit[0].name + ' として扱いました（種類は下で変えられます）';
          // 同じ弾の別の種類（【傷・BOX】【シュリンク無しBOX】【カートン】など）を選び直せるように残す
          it.cands = res.filter(function (r) { return norm(r.name).indexOf(nf) >= 0; });
          return [hit[0]];
        }
      }
      return res.length ? { res: res } : null;
    });
  }

  // ---------- 照合 ----------
  function resolve(it) {
    return search(it.input).then(function (res) {
      var exact = res.filter(function (r) { return norm(r.name) === norm(it.input); });
      if (exact.length) return exact;
      return (it.whole ? search(it.whole) : Promise.resolve([])).then(function (res2) {
        var ex2 = res2.filter(function (r) { return norm(r.name) === norm(it.whole); });
        if (ex2.length) { it.input = it.whole; it.qty = 1; it.info = '末尾の数字は商品名の一部として扱いました（1個）'; return ex2; }
        return byExpand(it).then(function (r) { return r || { res: res }; });
      });
    }).then(function (r) {
      if (Array.isArray(r)) {
        if (r.length === 1) { it.pick = r[0]; return; }
        it.cands = r; it.why = '同じ名前の商品が複数のカテゴリにあります。選んでください';
        return;
      }
      if (r.res.length) { it.cands = r.res.slice(0, 50); it.why = '商品名が完全には一致しません。候補から選んでください'; return; }
      // 1件も無いときは、【】を外した一番長い語で探し直す
      var words = it.input.normalize('NFKC').replace(/【[^】]*】|\[[^\]]*\]|［[^］]*］/g, ' ').split(/\s+/).filter(Boolean)
        .sort(function (a, b) { return b.length - a.length; });
      if (!words.length) { it.why = '商品が見つかりません'; return; }
      return search(words[0]).then(function (res3) {
        it.cands = res3.slice(0, 50);
        it.why = res3.length ? '商品名が見つかりません。候補から選んでください' : '商品が見つかりません';
      });
    }).then(function () { return it.pick ? load(it) : null; });
  }

  function load(it) {
    it.why = null;
    return getProduct(it.pick.cat, it.pick.name).then(function (p) {
      it.product = p;
      return historyToday(p).then(function (hs) {
        var done = hs.filter(isOurs).reduce(function (a, h) { return a + (h.diff || 0); }, 0);
        it.done = done; // 今日すでに同じ理由で動かした数（マイナス）
        // サイト更新後は在庫より多くは引けない（在庫0以下だと「削減」ボタンが押せない）→ 送らずに赤で残す
        if (p.stock + delta(it) < 0) { it.why = '在庫不足：在庫 ' + p.stock + ' に対して ' + it.qty + '個は引けません'; it.use = false; }
      });
    }).catch(function (e) { it.product = null; it.why = e.message; it.use = false; });
  }

  function check() {
    var items = parseInput($('input').value);
    state.reason = $('reason').value.trim();
    state.sign = +panel.querySelector('input[name="sig-mode"]:checked').value;
    state.word = state.sign > 0 ? '足し' : '引き';
    if (!state.reason) { setStatus('<b class="ng">詳細理由を入れてください。</b>'); return; }
    if (!items.length) { setStatus('<b class="ng">商品が入っていません。</b>'); return; }
    var bad = items.filter(function (it) { return !(it.qty > 0); });
    if (bad.length) { setStatus('<b class="ng">個数が0以下の行があります（' + bad[0].lines.join(',') + '行目）</b>'); return; }
    state.items = items;
    $('preview').innerHTML = ''; $('result').innerHTML = ''; $('run').style.display = 'none';
    var i = 0;
    function next() {
      if (i >= items.length) { setStatus('照合完了：' + items.length + '商品'); return; }
      setStatus('照合中… ' + (i + 1) + ' / ' + items.length + '（' + esc(items[i].input) + '）');
      return resolve(items[i++]).catch(function (e) { items[i - 1].why = e.message; }).then(next);
    }
    lock(true);
    next().then(function () { lock(false); render(); }, function (e) { lock(false); setStatus('<b class="ng">エラー：' + esc(e.message) + '</b>'); });
  }

  function render() {
    var its = state.items;
    var ready = its.filter(function (it) { return it.product && !it.why; });
    var html = '<div class="box"><b class="ok">' + state.word + 'ができる：' + ready.length + '商品</b>' +
      (state.sign > 0 ? '　<b class="info">【足す】</b>' : '　<b>【引く】</b>');
    var ng = its.length - ready.length;
    if (ng) html += '　<b class="ng">要対応：' + ng + '商品</b>（赤い行）';
    var dup = its.filter(function (it) { return it.product && it.done; });
    if (dup.length) html += '<br><span class="info">今日すでに「' + esc(state.reason) + '」で在庫を動かした記録がある商品：' + dup.length + '（二重にならないか確認してください）</span>';
    html += '</div><table><tr><th>実行</th><th>行</th><th>商品</th><th>今の在庫</th><th>変更数</th><th>変更後</th><th>メモ</th></tr>';
    its.forEach(function (it, idx) {
      var p = it.product, ok = p && !it.why;
      html += '<tr class="' + (ok ? '' : 'skip') + '"><td><input type="checkbox" data-idx="' + idx + '"' + (ok && it.use ? ' checked' : '') + (ok ? '' : ' disabled') + '></td>' +
        '<td>' + it.lines.join(',') + '</td><td>';
      if (p) html += esc(p.name) + '<br><small>' + esc(it.pick.catName) + ' / ' + esc(it.pick.sub) + '　ID ' + esc(p.pid) + '</small>';
      else html += '<span class="ng">' + esc(it.input) + '</span>';
      if (it.cands.length > (p ? 1 : 0) && !it.result) {
        html += '<br><select data-pick="' + idx + '">' +
          (p ? '' : '<option value="">候補から選ぶ（' + it.cands.length + '件）</option>') +
          it.cands.map(function (c, ci) {
            var sel = p && it.pick && c.cat === it.pick.cat && c.name === it.pick.name;
            return '<option value="' + ci + '"' + (sel ? ' selected' : '') + '>' + esc(c.name) + '（' + esc(c.catName) + '・在庫' + c.stock + '）</option>';
          }).join('') + '</select>';
      }
      html += '</td><td class="n">' + (p ? p.stock : '') + '</td><td class="n"><b>' + signed(delta(it)) + '</b></td><td class="n">' + (p ? (p.stock + delta(it) < 0 ? '<b class="ng">' + (p.stock + delta(it)) + '</b>' : p.stock + delta(it)) : '') + '</td><td>' +
        (it.why ? '<span class="ng">' + esc(it.why) + '</span><br>' : '') +
        (it.info ? '<span class="info">' + esc(it.info) + '</span><br>' : '') +
        (it.done ? '<span class="info">今日すでに動かした分：' + signed(it.done) + '</span>' : '') +
        (it.result ? '<b class="' + (it.result === '成功' ? 'ok' : 'ng') + '">' + esc(it.result) + '</b> ' + esc(it.msg || '') : '') +
        '</td></tr>';
    });
    html += '</table>';
    $('preview').innerHTML = html;
    $('run').style.display = ready.length ? '' : 'none';
    $('word').textContent = state.word;
    $('runbtn').textContent = '在庫を' + (state.sign > 0 ? '足す' : '引く');
  }

  function lock(on) { panel.querySelectorAll('button,input,textarea,select').forEach(function (el) { if (!el.classList.contains('x')) el.disabled = on; }); }

  // ---------- 実行 ----------
  function run() {
    var target = state.items.filter(function (it) { return it.product && !it.why && it.use && !it.result; });
    if (!target.length) return;
    var total = target.reduce(function (a, it) { return a + it.qty; }, 0);
    if (!confirm((state.sign > 0 ? '【足す】浅草橋の在庫に ' : '【引く】浅草橋の在庫から ') + target.length + '商品（合計 ' + total + '個）を' + state.word + 'ます。\n' +
      '在庫履歴に「手動変更・' + state.reason + '」として残ります。\n元に戻すには在庫管理画面で手で直す必要があります。\n\n実行しますか？')) return;
    lock(true);
    var ok = 0, ng = 0, i = 0;
    function next() {
      if (i >= target.length) return done();
      var it = target[i++];
      setStatus('処理中… ' + i + ' / ' + target.length + '（' + esc(it.product.name) + '）');
      return one(it).then(function (r) {
        it.result = r.result; it.msg = r.msg;
        r.result === '成功' ? ok++ : ng++;
      }).catch(function (e) {
        it.result = '失敗'; it.msg = e.message; ng++;
      }).then(function () {
        state.log.push([today(), it.lines.join(' '), it.product.pid, it.product.jan, it.product.name, signed(delta(it)), it.before, it.after, state.reason, it.result, it.msg || '']);
        return wait(300);
      }).then(next);
    }
    function done() {
      setStatus('<b class="' + (ng ? 'ng' : 'ok') + '">完了：成功 ' + ok + '商品 / 失敗・要確認 ' + ng + '商品</b>');
      $('result').innerHTML = '<div class="box"><button data-act="log">結果をCSVで保存</button></div>';
      lock(false);
      render();
    }
    next();
  }

  // 1商品：直前に在庫を読み直す → 「削減」「追加」で個数を送る → 在庫履歴で確かめる
  function one(it) {
    return getProduct(it.product.cat, it.product.name).then(function (p) {
      var before = p.stock, after = before + delta(it);
      it.before = before; it.after = after;
      if (after < 0) throw new Error('在庫不足：今の在庫 ' + before + ' に対して ' + it.qty + '個は引けません');
      var form = state.sign > 0 ? p.add : p.reduce;
      var fd = new FormData();
      Array.prototype.forEach.call(form.elements, function (el) {
        if (!el.name || el.type === 'checkbox' || el.type === 'submit' || el.type === 'button') return;
        fd.append(el.name, el.value);
      });
      fd.set('product_id', p.pid);
      fd.set('expected_before_stock', String(before)); // 読み直した後に在庫が動いていたらサイト側で止めてもらう
      fd.set('quantity', String(it.qty));
      fd.set('reason', state.reason);
      // 足すときは「追加合計原価」が必須。平均原価×個数（未設定なら0円）にして、平均原価が変わらないようにする
      if (state.sign > 0) fd.set('total_cost', String(Math.round((p.avgCost || 0) * it.qty)));
      return fetch(form.action, { method: 'POST', body: fd, credentials: 'same-origin' }).then(function (r) {
        if (!r.ok) throw new Error('送信エラー HTTP ' + r.status);
        return historyToday(p);
      }).then(function (hs) {
        var mine = hs.filter(function (h) { return isOurs(h) && h.after === after; })[0];
        if (!mine) return { result: '要確認', msg: '在庫履歴に記録が見つかりません。在庫管理画面で確認してください（送信前の在庫 ' + before + '）' };
        if (mine.diff !== delta(it)) {
          return { result: '要確認', msg: '入庫と重なった可能性：履歴の変更数は ' + signed(mine.diff) + '（' + mine.before + '→' + mine.after + '）。本来の変更数は ' + signed(delta(it)) };
        }
        return { result: '成功', msg: before + ' → ' + after };
      });
    });
  }

  function saveLog() {
    var rows = [['日付', '入力行', '商品ID', 'JAN', '商品名', '変更数', '変更前', '変更後', '詳細理由', '結果', 'メッセージ']].concat(state.log);
    var csv = '﻿' + rows.map(function (r) { return r.map(function (v) { v = String(v == null ? '' : v); return /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; }).join(','); }).join('\r\n');
    var a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
    var d = new Date();
    a.download = 'sig_在庫引き_' + d.getFullYear() + ('0' + (d.getMonth() + 1)).slice(-2) + ('0' + d.getDate()).slice(-2) + '_' + ('0' + d.getHours()).slice(-2) + ('0' + d.getMinutes()).slice(-2) + '.csv';
    a.click();
  }

  // ---------- 小窓の移動 ----------
  var POS_KEY = 'sigStockOutPos';
  function place(left, top) {
    var maxL = window.innerWidth - 80, maxT = window.innerHeight - 40;
    panel.style.left = Math.max(0, Math.min(left, maxL)) + 'px';
    panel.style.top = Math.max(0, Math.min(top, maxT)) + 'px';
    panel.style.right = 'auto';
  }
  try {
    var saved = JSON.parse(localStorage.getItem(POS_KEY) || 'null');
    if (saved) place(saved.left, saved.top);
  } catch (e) { }
  $('handle').addEventListener('mousedown', function (e) {
    if (e.button !== 0) return;
    e.preventDefault();
    var rect = panel.getBoundingClientRect();
    var dx = e.clientX - rect.left, dy = e.clientY - rect.top;
    function move(ev) { place(ev.clientX - dx, ev.clientY - dy); }
    function up() {
      document.removeEventListener('mousemove', move);
      document.removeEventListener('mouseup', up);
      try { localStorage.setItem(POS_KEY, JSON.stringify({ left: parseInt(panel.style.left, 10), top: parseInt(panel.style.top, 10) })); } catch (e) { }
    }
    document.addEventListener('mousemove', move);
    document.addEventListener('mouseup', up);
  });

  // ---------- イベント ----------
  panel.addEventListener('click', function (e) {
    var act = e.target.getAttribute && e.target.getAttribute('data-act');
    if (act === 'close') panel.remove();
    else if (act === 'check') check();
    else if (act === 'run') run();
    else if (act === 'log') saveLog();
  });
  panel.addEventListener('change', function (e) {
    var t = e.target;
    if (t.name === 'sig-mode') {
      // 照合した時の「引く／足す」で確認一覧を作っているので、切り替えたら照合し直す
      state.items = [];
      $('preview').innerHTML = ''; $('result').innerHTML = ''; $('run').style.display = 'none';
      setStatus('<b class="info">「' + (t.value === '1' ? '足す' : '引く') + '」に切り替えました。もう一度「照合する」を押してください。</b>');
      return;
    }
    if (t.hasAttribute('data-idx')) { state.items[+t.getAttribute('data-idx')].use = t.checked; return; }
    if (t.hasAttribute('data-pick') && t.value !== '') {
      var it = state.items[+t.getAttribute('data-pick')];
      it.pick = it.cands[+t.value];
      it.use = true;
      it.info = '入力「' + it.input + '」→ 候補から選択';
      setStatus('読み込み中…');
      lock(true);
      load(it).then(function () { setStatus(''); lock(false); render(); });
    }
  });
})();
