/**
 * Клиентский скрипт страницы подписки.
 *
 * Отдельным файлом по той же причине, что и стили: 280 строк, которые
 * сборка разметки только вставляет. Из страницы сюда приезжают ровно пять
 * значений, и ни одно из них не адрес конфига: тело конфига на странице не
 * печатается, за ним всегда идёт запрос.
 */
export interface PageScriptOpts {
  /** Адрес подписки, его копируют кнопки и показывает окно переноса. */
  subUrl: string;
  /** Платформы без камеры: у них нет кнопки переноса. */
  noTransfer: readonly string[];
  /** Слово, которым кнопка отвечает на удачное копирование. */
  copied: string;
  /** Подписи переключателя списка, свёрнуто и раскрыто. */
  hideAll: string;
  showAll: string;
}

export function pageScript(o: PageScriptOpts): string {
  return String.raw`
  (function () {
    var SUB_URL = ${JSON.stringify(o.subUrl)};
    var NO_TRANSFER = ${JSON.stringify(o.noTransfer)};
    // Copy the subscription link.
    var b = document.getElementById('copy'), i = document.getElementById('url');
    if (b) {
      b.addEventListener('click', function () {
        // Only the words change. The button holds a glyph and two labels (one
        // for the phone), and textContent on the button itself would delete
        // all three and leave a bare word behind.
        var full = b.querySelector('.hbtn__full'), short = b.querySelector('.hbtn__short');
        var done = function () {
          var of = full && full.textContent, os = short && short.textContent;
          if (full) full.textContent = ${JSON.stringify(o.copied)};
          if (short) short.textContent = ${JSON.stringify(o.copied)};
          setTimeout(function () {
            if (full) full.textContent = of;
            if (short) short.textContent = os;
          }, 1500);
        };
        if (navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(SUB_URL).then(done).catch(function () {
            if (i) { i.select(); document.execCommand('copy'); }
            done();
          });
        } else if (i) { i.select(); document.execCommand('copy'); done(); }
        else { done(); }
      });
    }
    // The link card's own button. A plain one: its whole content is the word,
    // so textContent is safe here and would not be on the header button.
    var b2 = document.getElementById('copy-inline');
    if (b2 && i) {
      b2.addEventListener('click', function () {
        i.select();
        var o = b2.textContent;
        var done = function () { b2.textContent = ${JSON.stringify(o.copied)}; setTimeout(function () { b2.textContent = o; }, 1500); };
        if (navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(SUB_URL).then(done).catch(function () { document.execCommand('copy'); done(); });
        } else { document.execCommand('copy'); done(); }
      });
    }
    // Copy AmneziaVPN vpn:// keys (paste into the app "add by key").
    [].slice.call(document.querySelectorAll('.copyk')).forEach(function (btn) {
      btn.addEventListener('click', function () {
        var key = btn.getAttribute('data-key') || '';
        var done = function () { var o = btn.textContent; btn.textContent = ${JSON.stringify(o.copied)}; setTimeout(function () { btn.textContent = o; }, 1500); };
        var fallback = function () { var ta = document.createElement('textarea'); ta.value = key; ta.style.position = 'fixed'; ta.style.opacity = '0'; document.body.appendChild(ta); ta.select(); try { document.execCommand('copy'); } catch (e) {} document.body.removeChild(ta); done(); };
        if (navigator.clipboard && navigator.clipboard.writeText) { navigator.clipboard.writeText(key).then(done).catch(fallback); }
        else { fallback(); }
      });
    });
    // AmneziaWG keys: server chooser plus the AmneziaVPN/AmneziaWG pair, one
    // code visible at a time. Every figure is already in the page; this only
    // decides which one is shown.
    (function () {
      var figs = [].slice.call(document.querySelectorAll('.qrf'));
      if (figs.length < 2) return; // one code, nothing to switch
      var picker = document.querySelector('[data-node-picker]');
      var nodeBtn = picker && picker.querySelector('[data-node-btn]');
      var nodeItems = [].slice.call(document.querySelectorAll('[data-node-picker] .platform__item'));
      var appBtns = [].slice.call(document.querySelectorAll('.seg-group .seg-btn'));
      var onFig = figs.filter(function (f) { return f.classList.contains('on'); })[0] || figs[0];
      var curTarget = onFig.getAttribute('data-target');
      var curApp = 'vpn';
      function render() {
        figs.forEach(function (f) {
          f.classList.toggle(
            'on',
            f.getAttribute('data-target') === curTarget && f.getAttribute('data-app') === curApp
          );
        });
        nodeItems.forEach(function (it) {
          var on = it.getAttribute('data-target') === curTarget;
          it.classList.toggle('is-on', on);
          it.setAttribute('aria-selected', on ? 'true' : 'false');
          // The button repeats the chosen row's own label, so the two can
          // never disagree about which server is selected.
          if (on && picker) {
            var name = picker.querySelector('[data-node-name]');
            if (name) name.textContent = it.querySelector('span').textContent;
          }
        });
        appBtns.forEach(function (b) {
          var on = b.getAttribute('data-app') === curApp;
          b.classList.toggle('is-on', on);
          b.setAttribute('aria-selected', on ? 'true' : 'false');
        });
        if (picker) picker.classList.remove('is-open');
        if (nodeBtn) nodeBtn.setAttribute('aria-expanded', 'false');
      }
      if (nodeBtn) {
        nodeBtn.addEventListener('click', function (e) {
          e.stopPropagation();
          var open = picker.classList.toggle('is-open');
          nodeBtn.setAttribute('aria-expanded', open ? 'true' : 'false');
        });
        document.addEventListener('click', function () { picker.classList.remove('is-open'); });
        document.addEventListener('keydown', function (e) { if (e.key === 'Escape') picker.classList.remove('is-open'); });
      }
      nodeItems.forEach(function (it) {
        it.addEventListener('click', function () { curTarget = it.getAttribute('data-target'); render(); });
      });
      appBtns.forEach(function (b) {
        b.addEventListener('click', function () { curApp = b.getAttribute('data-app'); render(); });
      });
      render();
    })();
    // From here on the page is driven by script, so the no-script layout (every
    // panel open, the menu unfolded) can go.
    document.body.classList.remove('nojs');
    // Transfer window.
    var overlay = document.querySelector('[data-transfer]');
    var openBtn = document.querySelector('[data-open-transfer]');
    function closeTransfer() { if (overlay) overlay.classList.remove('is-open'); }
    if (overlay && openBtn) {
      openBtn.addEventListener('click', function (e) { e.stopPropagation(); overlay.classList.add('is-open'); });
      var closeBtn = overlay.querySelector('[data-close-transfer]');
      if (closeBtn) closeBtn.addEventListener('click', closeTransfer);
      // Anywhere outside the panel, and Escape. A modal with one way out is a
      // trap on a phone, where the close button is at the far corner.
      overlay.addEventListener('click', function (e) { if (e.target === overlay) closeTransfer(); });
      document.addEventListener('keydown', function (e) { if (e.key === 'Escape') closeTransfer(); });
      var mc = overlay.querySelector('[data-copy-modal]');
      if (mc) {
        mc.addEventListener('click', function () {
          var word = mc.querySelector('span');
          var done = function () {
            if (!word) return;
            var o = word.textContent;
            word.textContent = ${JSON.stringify(o.copied)};
            setTimeout(function () { word.textContent = o; }, 1500);
          };
          if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(SUB_URL).then(done).catch(done);
          else done();
        });
      }
    }
    // Platform selector. Its rows are taken from INSIDE its own picker: the
    // AmneziaWG server chooser above is the same control down to the class
    // (.platform__item), and a page-wide query took its rows in too (E43,
    // stand 26.09). Picking a server then ran show() with no platform: every
    // panel hid, and the platform button took the server's name.
    var picker = document.querySelector('[data-platform-picker]');
    var items = picker ? [].slice.call(picker.querySelectorAll('.platform__item')) : [];
    var panels = [].slice.call(document.querySelectorAll('.panel'));
    var pickerBtn = picker && picker.querySelector('[data-platform-btn]');
    function show(p) {
      panels.forEach(function (pl) { pl.classList.toggle('is-on', pl.getAttribute('data-platform') === p); });
      items.forEach(function (it) {
        var on = it.getAttribute('data-pick') === p;
        it.classList.toggle('is-on', on);
        it.setAttribute('aria-selected', on ? 'true' : 'false');
        if (on && picker) {
          var icon = picker.querySelector('[data-platform-icon]');
          var name = picker.querySelector('[data-platform-name]');
          // Reuse the menu row's own glyph and label: one source for both, so
          // the button can never end up naming a different platform.
          if (icon) icon.innerHTML = it.querySelector('svg').outerHTML;
          if (name) name.textContent = it.querySelector('span').textContent;
        }
      });
      if (picker) picker.classList.remove('is-open');
      if (pickerBtn) pickerBtn.setAttribute('aria-expanded', 'false');
      // No transfer button on a television or a router. Same reason the QR is
      // not offered there: nothing on those devices can read a code, and a
      // button leading to one is a control that cannot be used.
      if (openBtn) openBtn.hidden = NO_TRANSFER.indexOf(p) !== -1;
      if (overlay && NO_TRANSFER.indexOf(p) !== -1) closeTransfer();
      // Downloads: lift the group this platform is about, tint its title, hide
      // nothing. Somebody takes a file FOR another device, so the router rows
      // matter most to the person sitting at a laptop.
      var want = p === 'router' ? 'router' : 'clients';
      [].slice.call(document.querySelectorAll('[data-dl-group]')).forEach(function (g) {
        g.classList.toggle('is-relevant', g.getAttribute('data-dl-group') === want);
      });
      // Точка на строках, которые подходят этой платформе. Число строк при
      // этом не меняется: если счётчик над блоком поедет, значит резка по
      // платформе вернулась, а её тут быть не должно.
      [].slice.call(document.querySelectorAll('[data-dl-fits]')).forEach(function (r) {
        var fits = r.getAttribute('data-dl-fits');
        r.classList.toggle('is-fit', !!fits && fits.split(' ').indexOf(p) !== -1);
      });
    }
    if (pickerBtn) {
      pickerBtn.addEventListener('click', function (e) {
        e.stopPropagation();
        var open = picker.classList.toggle('is-open');
        pickerBtn.setAttribute('aria-expanded', open ? 'true' : 'false');
      });
      document.addEventListener('click', function () { picker.classList.remove('is-open'); });
      document.addEventListener('keydown', function (e) { if (e.key === 'Escape') picker.classList.remove('is-open'); });
    }
    items.forEach(function (it) { it.addEventListener('click', function () { show(it.getAttribute('data-pick')); }); });

    // Выбор клиента. Карточка загорается, и два первых шага начинают говорить
    // про НЕГО: куда идти за этим приложением и какой кнопкой отдать подписку
    // именно ему. Ни один адрес не лежит в скрипте, всё читается с карточки.
    function pickApp(card) {
      var panel = card.closest('.panel');
      if (!panel) return;
      [].slice.call(panel.querySelectorAll('.app-card')).forEach(function (c) {
        c.classList.toggle('is-on', c === card);
      });
      var name = card.getAttribute('data-app') || '';
      [].slice.call(panel.querySelectorAll('[data-app-label]')).forEach(function (el) {
        el.textContent = name;
      });
      var site = card.getAttribute('data-app-site');
      var get = panel.querySelector('[data-app-get]');
      if (get) {
        // Кнопки нет у клиента без проверенного адреса: отправить человека в
        // никуда хуже, чем не отправить никуда.
        if (site) { get.setAttribute('href', site); get.parentNode.hidden = false; }
        else { get.removeAttribute('href'); get.parentNode.hidden = true; }
      }
      var put = panel.querySelector('[data-app-put]');
      if (put) {
        var add = card.getAttribute('data-app-add');
        var deep = card.getAttribute('data-app-kind') === 'deeplink';
        if (deep && add) { put.setAttribute('href', add); put.parentNode.hidden = false; }
        else { put.removeAttribute('href'); put.parentNode.hidden = true; }
      }
    }
    [].slice.call(document.querySelectorAll('.app-card')).forEach(function (card) {
      card.addEventListener('click', function () { pickApp(card); });
    });
    // A link that is already in the markup, copied as it stands. The MTProto
    // rows use this: there is nothing to fetch, the proxy link IS the thing,
    // and it carries no user credential beyond the proxy secret that every
    // user of that inbound shares anyway.
    [].slice.call(document.querySelectorAll('[data-copy-text]')).forEach(function (btn) {
      btn.addEventListener('click', function () {
        var word = btn.querySelector('span');
        var text = btn.getAttribute('data-copy-text') || '';
        var original = word ? word.textContent : '';
        var say = function (s) { if (word) word.textContent = s; };
        var done = function () { say(${JSON.stringify(o.copied)}); setTimeout(function () { say(original); }, 1500); };
        var fallback = function () {
          var ta = document.createElement('textarea'); ta.value = text;
          ta.style.position = 'fixed'; ta.style.opacity = '0';
          document.body.appendChild(ta); ta.select();
          try { document.execCommand('copy'); } catch (e) {}
          document.body.removeChild(ta); done();
        };
        if (navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(text).then(done).catch(fallback);
        } else { fallback(); }
      });
    });
    // "Config" puts the BODY of that format in the clipboard, fetched from
    // the same address the download button uses.
    //
    // Fetched rather than embedded, and that is the whole point: a config body
    // carries the login, the keys and the passwords in clear text, so putting
    // it in the markup or in a variable here would leak it into the page
    // source for anyone who opens it or saves it. The request goes to our own
    // origin, so the no-external-requests rule is untouched.
    [].slice.call(document.querySelectorAll('[data-copy-config]')).forEach(function (btn) {
      btn.addEventListener('click', function () {
        var word = btn.querySelector('span');
        var url = btn.getAttribute('data-copy-config') || '';
        var original = word ? word.textContent : '';
        var say = function (s) { if (word) word.textContent = s; };
        var back = function () { setTimeout(function () { say(original); }, 1500); };
        if (!navigator.clipboard || !navigator.clipboard.writeText || !window.fetch) return;
        fetch(url, { credentials: 'omit' })
          .then(function (r) { return r.text(); })
          .then(function (body) { return navigator.clipboard.writeText(body); })
          .then(function () { say(${JSON.stringify(o.copied)}); back(); })
          // Say nothing false: the label goes back and the reader still has
          // the download button, which needs no clipboard permission at all.
          .catch(function () { say(original); });
      });
    });
    // Second level: one expander per platform panel, each with its own label.
    [].slice.call(document.querySelectorAll('[data-all-apps]')).forEach(function (box) {
      var btn = box.querySelector('[data-toggle-all]');
      if (!btn) return;
      var word = btn.querySelector('span');
      btn.addEventListener('click', function () {
        var open = box.classList.toggle('is-open');
        btn.setAttribute('aria-expanded', open ? 'true' : 'false');
        if (word) word.textContent = open ? ${JSON.stringify(o.hideAll)} : ${JSON.stringify(o.showAll)};
      });
    });
    // Pre-select the platform matching the visitor's device, if it is offered.
    var ua = navigator.userAgent || '';
    var guess = null;
    if (/iPhone|iPad|iPod/.test(ua)) guess = 'ios';
    else if (/Android/.test(ua)) guess = /TV|BRAVIA|AFT|SmartTV/.test(ua) ? 'androidtv' : 'android';
    else if (/Macintosh|Mac OS X/.test(ua)) guess = 'macos';
    else if (/Windows/.test(ua)) guess = 'windows';
    else if (/Linux/.test(ua)) guess = 'linux';
    // Показать надо в любом случае, а не только когда UA угадался: панель
    // сервер уже открыл, но отметки в блоке конфигов ставит этот же вызов, и
    // без него читатель с неузнанным UA не увидел бы ни одной точки.
    var known = guess && items.some(function (it) { return it.getAttribute('data-pick') === guess; });
    // One platform, no picker: the panel the server opened is the platform.
    var first = items[0] ? items[0].getAttribute('data-pick') : panels[0] && panels[0].getAttribute('data-platform');
    if (known) show(guess);
    else if (first) show(first);
  })();
`;
}
