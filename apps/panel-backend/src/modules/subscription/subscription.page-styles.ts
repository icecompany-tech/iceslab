/**
 * Стили страницы подписки.
 *
 * Отдельным файлом, потому что это 490 строк, которые не участвуют ни в
 * одном решении рендера: сборка разметки их только вставляет. Пока они жили
 * внутри шаблона, правка одного правила показывалась в diff вперемешку с
 * разметкой, а файл страницы читался на 2600 строк.
 *
 * Ни одной подстановки внутри нет и быть не должно: как только сюда попадёт
 * ${...}, это перестанет быть таблицей стилей и станет ещё одним шаблоном.
 */
export const PAGE_CSS = String.raw`
  /* Palette from the mockup (Paper, file icelab-panel, column 12). Names are
     kept where they already existed, so a later change is one place. */
  :root{
    --ground:#0A0F16; --card:#0E1621; --card2:#111B27; --tile:#131E2B;
    --sunk:#0B121B; --hair:#1E2936; --hair2:#23303F;
    --edge-accent:#2B7A8C; --edge-accent2:#2B5A66;
    --snow:#F0F5FA; --mist:#7E8EA0; --faint:#5B6B80;
    --cyan:#4FD1C5; --cyan-bg:#0D1A21; --brand:#7DD3FC;
    --warn:#F2B355; --warn-ink:#C9A56A; --warn-bg:#1C1810; --warn-edge:#4A3A1E;
    --bad:#F87171;  --bad-ink:#C98A8A;  --bad-bg:#1C1418;  --bad-edge:#4A2229;
    --ok:#4ADE80;   --ok-ink:#7FBF95;   --ok-bg:#101E17;   --ok-edge:#2B663F;
    --mute-bg:#151C25; --mute-edge:#33404F; --mark:#8CA0B8;
    --col:740px;
    /* Older names, still used by the blocks that have not been rebuilt yet
       (the link card, the platform tabs, the QR widget, the downloads). Each
       points at its nearest new value so the page is one design in the
       meantime; they go away with the markup that uses them. */
    --ground2:var(--sunk); --cyan2:var(--edge-accent); --moss:var(--ok); --dim:var(--faint);
    --mono:'Geist Mono Variable',ui-monospace,SFMono-Regular,'SF Mono','Cascadia Code',Menlo,Consolas,monospace;
    --sans:'Space Grotesk','Inter',system-ui,-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;
  }
  body.stopped {
    background: radial-gradient(ellipse 46% 44% at 0 0, #8cd7ff33, #8cd7ff15 35%, #8cd7ff06 65%, transparent), #05070a;
    color: #f2f3ee;
    font: 13px/18px system-ui, sans-serif;
  }
  body.stopped::before { display: none; }
  .stopped-page { width: calc(100% - 32px); max-width: 1088px; margin: auto; }
  .stopped-head, .stopped-row { display: flex; align-items: center; justify-content: space-between; gap: 10px; }
  .stopped-head { min-height: 64px; font: 600 16px/22px system-ui, sans-serif; }
  .stopped-head details { position: relative; font-size: 12px; }
  .stopped-head summary, .stopped-head nav { border: 1px solid #f2f3ee3d; border-radius: 6px; background: #0b0f13; }
  .stopped-head summary { display: flex; align-items: center; gap: 4px; min-height: 28px; padding: 2px 8px; cursor: pointer; list-style: none; }
  .stopped-head summary::-webkit-details-marker { display: none; }
  .stopped-head nav { position: absolute; right: 0; z-index: 1; padding: 4px; }
  .stopped-head a { display: block; padding: 4px 10px; color: inherit; }
  .stopped-main { display: grid; gap: 20px; max-width: 560px; margin: auto; padding: 24px 0 40px; }
  .stopped-card { display: flex; flex-direction: column; gap: 14px; padding: 16px; background: #0b0f13; border: 1px solid #ff5d4f59; border-radius: 14px; }
  .stopped-name { font-size: 18px; line-height: 24px; }
  .stopped-sub-card[data-status='disabled'] { border-color: #8893a059; }
  .stopped-sub-card[data-status='disabled'] .stopped-badge::before { background: #8893a0; }
  .stopped-badge { display: inline-flex; align-items: center; gap: 7px; }
  .stopped-badge::before { content: ''; background: #ff5d4f; width: 7px; height: 7px; border-radius: 50%; }
  .stopped-card h1 { margin: 0; font-size: 15px; line-height: 22px; font-weight: 600; }
  .stopped-card p { margin: 0; color: #8893a0; }
  .stopped-card .stopped-reason { margin-top: 4px; color: #a3adb8; }
  .stopped-row > span:first-child { color: #8893a0; }
  .stopped-card .support, .stopped-link button { display: flex; align-items: center; justify-content: center; gap: 7px; margin: 0; font-family: inherit; font-size: 14px; border: 1px solid #a8e6ff73; border-radius: 10px; color: #e4f7ff; text-decoration: none; font-weight: 600; min-height: 44px; }
  .stopped-link { border-color: #1c2430; gap: 10px; }
  .stopped-link label { font-size: 14px; font-weight: 600; }
  .stopped-link input { width: 100%; padding: 10px 12px; color: #b4bdc8; background: #05070a; border: 1px solid #1c2430; border-radius: 10px; font: 12px/18px ui-monospace, monospace; }
  .stopped-link button { min-height: 40px; border-color: #f2f3ee3d; }
  .stopped-link button { font-size: 13px; }
  .stopped-link p { font-size: 12px; line-height: 16px; }
  @media (max-width: 600px) {
    body.stopped { background-image: radial-gradient(ellipse 90% 26% at 0 0, #8cd7ff33, #8cd7ff15 35%, transparent); }
    .stopped-head { min-height: 56px; }
    .stopped-main { padding: 0 0 24px; gap: 12px; }
  }

  *{box-sizing:border-box;}
  html,body{margin:0; padding:0;}
  body{
    background:var(--ground); color:var(--snow); font-family:var(--sans);
    font-size:14px; line-height:1.45; -webkit-font-smoothing:antialiased;
    -moz-osx-font-smoothing:grayscale; overflow-wrap:anywhere; min-height:100vh;
  }
  button{font:inherit; color:inherit; background:none; border:0; padding:0; cursor:pointer;}
  svg{flex-shrink:0;}
  .sr{position:absolute; width:1px; height:1px; overflow:hidden; clip:rect(0 0 0 0); white-space:nowrap;}
  /* Ambient: a faint blueprint grid + one calm cyan glow up top. */
  body::before{
    content:""; position:fixed; inset:0; z-index:-1; pointer-events:none;
    background:
      radial-gradient(900px 420px at 50% -120px, rgba(125,211,252,.10), transparent 70%),
      linear-gradient(var(--hair) 1px, transparent 1px) 0 0/100% 34px,
      linear-gradient(90deg, var(--hair) 1px, transparent 1px) 0 0/34px 100%;
    background-color:var(--ground);
    opacity:1;
    -webkit-mask-image:radial-gradient(closest-side at 50% 18%, #000 60%, transparent 100%);
            mask-image:radial-gradient(closest-side at 50% 18%, #000 60%, transparent 100%);
  }
  .page{display:flex; flex-direction:column; align-items:center; min-height:100vh;}
  /* Колонка ровно --col ШИРИНОЙ СОДЕРЖИМОГО, а не вместе с полями.
     Полоса кнопок в шапке ограничена --col без полей и выходила 740, а
     карточки под ней 708: два края, разъехавшиеся на 32 px, и пропорция
     ломалась ровно на стыке шапки и первой карточки. Поля по 16 нужны только
     на узком экране, поэтому они добавляются к пределу, а не вычитаются. */
  .wrap{width:100%; max-width:calc(var(--col) + 32px); padding:0 16px;
    display:flex; flex-direction:column; gap:24px;}

  /* Размер значка по умолчанию.
     Размеры задаются контекстом (.hbtn .ic, .tile__label .ic и так далее), и
     пока это был ЕДИНСТВЕННЫЙ источник размера, значок без своего правила
     оставался без ширины и высоты, а браузер давал безразмерному svg дефолт
     замещаемого элемента, 300x150. Так и разъезжались шевроны у «все
     приложения» и у блока конфигов. База ниже это просто страховка: любое
     контекстное правило её перекрывает, а без правила значок теперь мелкий,
     а не в пол-экрана. */
  .ic{width:16px; height:16px; flex-shrink:0;}
  .ic--sel{width:12px; height:12px;}

  /* Header: the mark and the name centred, the two things a reader does with
     this page on one row under them. The theme button the old header carried
     is deliberately gone - it promised a light theme that does not exist. */
  /* Нижнее поле у шапки есть, и оно не декоративное. В макете кнопки сидели
     в обёртке с полем 4 и рамкой, и именно она отделяла их от карточки под
     ними. Обёртку убрали, воздух ушёл вместе с ней, и кнопки слиплись с
     карточкой. Здесь он возвращён явно, тем же числом, что и зазор колонки. */
  .head{width:100%; display:flex; flex-direction:column; align-items:center; gap:18px; padding:30px 16px 24px;}
  .head__brand{display:flex; align-items:center; gap:10px;}
  .head__title{font-size:19px; font-weight:700; line-height:24px; letter-spacing:-.01em; color:var(--brand);}
  .head__brand .ic{width:20px; height:20px; color:var(--brand);}
  /* Две кнопки, а не сегментированная полоса.
     Полоса давала три рамки подряд почти одного цвета: своя, потом 4 px фона,
     потом кнопкина. На тёмном они сливались в одну линию, и кнопки читались
     слипшимися. Рамку и фон обёртки убрал, зазор поднял до 10: теперь это
     просто две кнопки, и между ними видно страницу. */
  .head__actions{
    width:100%; max-width:var(--col); display:flex; gap:10px;
  }
  .hbtn{
    flex:1 1 0; min-width:0; display:flex; align-items:center; justify-content:center; gap:8px;
    height:38px; border-radius:11px; background:var(--card2); border:1px solid var(--hair2);
    font-size:13px; font-weight:500; color:#C8D4E3; text-decoration:none;
  }
  .hbtn .ic{width:14px; height:14px;}
  .hbtn--qr{background:var(--cyan-bg); border-color:var(--edge-accent); color:var(--cyan);}
  .hbtn:hover{border-color:var(--edge-accent2);}
  .hbtn__short{display:none;}

  /* Cards */
  .card{background:var(--card); border:1px solid var(--hair); border-radius:18px; padding:22px; position:relative;}

  /* Subscription card: who this is, then four facts as tiles. */
  .sub-card{display:flex; flex-direction:column; gap:20px;}
  .sub-card__head{display:flex; align-items:center; gap:15px;}
  .sub-card__badge{
    width:42px; height:42px; flex-shrink:0; border-radius:999px;
    display:flex; align-items:center; justify-content:center;
    background:var(--ok-bg); border:1px solid var(--ok-edge); color:var(--ok);
  }
  .sub-card__badge .ic{width:17px; height:17px;}
  .sub-card__badge--warn{background:#241C10; border-color:#5B4726; color:var(--warn);}
  .sub-card__badge--bad{background:#2A1519; border-color:#5B2A31; color:var(--bad);}
  .sub-card__badge--mute{background:var(--mute-bg); border-color:var(--mute-edge); color:var(--mist);}
  .sub-card__who{flex:1 1 0; min-width:0; display:flex; flex-direction:column; gap:3px;}
  .sub-card__name{font-size:19px; font-weight:700; line-height:24px;}
  .sub-card__note{font-size:13px; line-height:17px; color:var(--mist);}
  .sub-card__note--warn{color:var(--warn-ink);}
  .sub-card__note--bad{color:var(--bad-ink);}
  .sub-card__grid{display:flex; flex-direction:column; gap:12px;}
  .sub-card__row{display:flex; gap:12px;}
  .tile{
    flex:1 1 0; min-width:0; min-height:74px; display:flex; flex-direction:column; gap:7px;
    padding:14px 16px; border-radius:13px; background:var(--tile); border:1px solid var(--hair2);
  }
  .tile--ok{background:var(--ok-bg); border-color:var(--ok-edge);}
  .tile--warn{background:var(--warn-bg); border-color:var(--warn-edge);}
  .tile--bad{background:var(--bad-bg); border-color:var(--bad-edge);}
  .tile--mute{background:var(--mute-bg); border-color:var(--mute-edge);}
  .tile__label{display:flex; align-items:center; gap:8px; min-height:16px; font-size:12px; line-height:16px; color:var(--mist);}
  .tile__label .ic{width:13px; height:13px;}
  .tile--ok .tile__label{color:var(--ok-ink);}
  .tile--warn .tile__label{color:var(--warn-ink);}
  .tile--bad .tile__label{color:var(--bad-ink);}
  .tile__value{font-size:15px; font-weight:700; line-height:19px; color:var(--snow); overflow-wrap:anywhere;}
  .lbl{color:var(--mist); font-family:var(--mono); font-size:10px; text-transform:uppercase;
    letter-spacing:.16em; margin-bottom:12px;}

  .protos{display:flex; flex-wrap:wrap; gap:6px; margin-top:6px;}
  .proto{font-family:var(--mono); font-size:10px; text-transform:uppercase; letter-spacing:.08em;
    color:var(--cyan); background:rgba(125,211,252,.07); border:1px solid rgba(125,211,252,.18);
    border-radius:6px; padding:3px 8px;}
  /* The protocols switcher: the same chip, pressable. Off is dim, on is the
     chip as it always looked, so a page with no narrowing reads as before. */
  a.proto--pick{text-decoration:none; cursor:pointer; opacity:.45; min-height:24px; display:inline-flex; align-items:center;}
  a.proto--pick.is-on{opacity:1; border-color:rgba(125,211,252,.55);}
  a.proto--pick:focus-visible{outline:2px solid var(--cyan); outline-offset:2px;}
  .protos__hint{margin-top:8px; font-size:12px; color:var(--dim); line-height:1.4;}

  /* Subscription link */
  .linkrow{display:flex; gap:8px;}
  input.link{flex:1; min-width:0; background:var(--ground2); border:1px solid var(--hair); color:var(--snow);
    border-radius:9px; padding:11px 12px; font-family:var(--mono); font-size:12px;}
  .copy{cursor:pointer; border:none; border-radius:9px; padding:0 16px; font-weight:600; font-size:13px;
    background:var(--cyan2); color:var(--ground); white-space:nowrap;}
  .copy:active{transform:translateY(1px);}

  /* Install block: the platform lives in the heading now. Eight of them do not
     fit a scrolling row at this width, and a scrolling row nobody notices is
     the same as a hidden one. */
  .install{display:flex; flex-direction:column; gap:18px;}
  .install__head{display:flex; align-items:center; gap:16px;}
  .install__title{flex:1 1 0; min-width:0; margin:0; font-size:20px; font-weight:700; line-height:24px;}
  .platform{position:relative; flex-shrink:0;}
  .platform__btn{display:flex; align-items:center; gap:10px; height:36px; padding:0 14px;
    border-radius:11px; background:var(--card2); border:1px solid var(--edge-accent);
    font-size:13px; font-weight:500; color:var(--snow);}
  .platform__btn .ic{width:15px; height:15px;}
  .platform__btn .ic--sel{width:11px; height:11px;}
  .platform__menu{position:absolute; right:0; top:calc(100% + 6px); z-index:40; min-width:200px;
    display:none; flex-direction:column; padding:6px; gap:2px;
    border-radius:12px; background:var(--card2); border:1px solid var(--hair2);
    box-shadow:0 18px 40px rgba(4,8,13,.55);}
  .platform.is-open .platform__menu{display:flex;}
  .platform__item{display:flex; align-items:center; gap:10px; height:34px; padding:0 10px;
    border-radius:8px; font-size:13px; color:#C8D4E3; text-align:left;}
  .platform__item .ic{width:15px; height:15px;}
  .platform__item:hover{background:var(--sunk);}
  .platform__item.is-on{color:var(--cyan); background:var(--cyan-bg);}
  /* No JS: the selector is a control, so without a script the reader must
     still be able to reach every platform. The menu opens in place and every
     panel is shown, one after another, rather than one panel and no way to
     the others. */
  .nojs .platform__menu{display:flex; position:static; margin-top:6px;}
  .nojs .panel{display:flex;}

  .panel{display:none; flex-direction:column; gap:18px;}
  .panel.is-on{display:flex; animation:fade .25s ease both;}
  @keyframes fade{from{opacity:0; transform:translateY(4px)}to{opacity:1; transform:none}}

  /* App card: the name, and the app's own mark bleeding off the corner. */
  .apps{display:flex; flex-direction:column; gap:10px;}
  /* Сетка, а не флекс с распорками.
     На флексе распорка и карточка расходились на 30 px: при flex-basis:0
     карточку не дают ужать меньше её боковых полей и рамки, распорке ужиматься
     нечем, и последний неполный ряд выходил шире полного. Колонки решают это
     по построению, и неполный ряд остаётся ровным без единой подпорки. */
  .apps__row{display:grid; grid-template-columns:repeat(4, minmax(0, 1fr)); gap:12px;}
  .app-card{min-width:0; width:100%; display:flex; align-items:center; gap:8px; height:54px;
    padding:0 14px; border-radius:12px; background:var(--card2); border:1px solid var(--hair2);
    position:relative; overflow:hidden; text-align:left; text-decoration:none; color:inherit;
    font:inherit; cursor:pointer;}
  .app-card:hover{border-color:var(--edge-accent2);}
  /* Выбранный клиент. Он же говорит, про что шаги ниже, поэтому отличаться
     должен не намёком: заливка, рамка и имя цветом сразу. */
  .app-card.is-on{background:var(--cyan-bg); border-color:var(--edge-accent);}
  .app-card.is-on .app-card__name{color:var(--cyan);}
  .app-card.is-on .app-card__mark{color:var(--cyan);}
  .app-card.is-on .app-card__glyph{color:var(--cyan);}
  .app-card__dot{width:6px; height:6px; flex-shrink:0; border-radius:999px; background:var(--warn);}
  .app-card__name{font-size:14px; font-weight:600; line-height:18px; color:var(--snow);
    white-space:nowrap; overflow:hidden; text-overflow:ellipsis;}
  .app-card__glyph{margin-left:auto; display:flex; color:var(--mist); position:relative; z-index:1;}
  .app-card__glyph .ic{width:15px; height:15px;}
  .app-card__mark{position:absolute; right:-12px; top:-14px; width:78px; height:78px;
    opacity:var(--mark-o,.14); color:var(--mark); pointer-events:none;}
  .mrk-big{width:100%; height:100%; display:block;}

  /* Telegram is not an app card and must not read as one: its proxies are its
     own, and they move that one messenger, not the device. */
  .tg-row{display:flex; align-items:center; gap:12px; min-height:62px; padding:10px 14px;
    border-radius:12px; background:var(--card2); border:1px solid var(--hair2);
    position:relative; overflow:hidden;}
  .tg-row__col{flex:1 1 0; min-width:0; display:flex; flex-direction:column; gap:3px; padding-right:84px;}
  .tg-row__name{font-size:14px; font-weight:600; line-height:18px;}
  .tg-row__note{font-size:12px; line-height:16px; color:var(--mist);}
  .tg-row__mark{position:absolute; right:-10px; top:-14px; width:86px; height:86px;
    opacity:.12; color:var(--mark); pointer-events:none;}
  /* Second level, folded. */
  .all-apps{display:flex; flex-direction:column; gap:16px; padding:18px; border-radius:14px;
    background:var(--sunk); border:1px solid var(--hair2);}
  .all-apps__top{display:flex; flex-direction:column; gap:6px;}
  .all-apps__line{display:flex; align-items:center; gap:10px;}
  .all-apps__title{font-size:15px; font-weight:700; line-height:18px;}
  .all-apps__count{padding:0 8px; height:20px; display:inline-flex; align-items:center;
    border-radius:999px; background:#1A2534; font-family:var(--mono); font-size:11px;
    line-height:14px; color:var(--mist);}
  .all-apps__toggle{margin-left:auto; display:flex; align-items:center; gap:8px;
    font-size:12px; line-height:16px; color:var(--mist);}
  .all-apps__toggle svg{transition:transform .15s;}
  .all-apps__note{font-size:12px; line-height:17px; color:var(--mist);}
  .all-apps__body{display:flex; flex-direction:column; gap:16px;}
  .all-apps:not(.is-open) .all-apps__body{display:none;}
  .all-apps:not(.is-open) .all-apps__toggle svg{transform:rotate(180deg);}
  /* Without a script there is nobody to open it, so it starts open. */
  .nojs .all-apps__body{display:flex;}
  .nojs .all-apps__toggle{display:none;}
  .all-apps__group{display:flex; flex-direction:column; gap:10px;}
  .all-apps__group-title{font-family:var(--mono); font-size:10px; line-height:12px;
    letter-spacing:.14em; color:var(--faint);}
  .all-apps__row{display:grid; grid-template-columns:repeat(3, minmax(0, 1fr)); gap:12px;}
  /* Пустая ячейка сетки. Ширину держит колонка, поэтому распорке нечего
     задавать, но и убирать её из разметки незачем: ряд остаётся читаемым. */
  .spacer{display:block;}

  /* A line that explains rather than offers: used where the short list IS the
     answer, and later where a television cannot do what a phone can. */
  .note-strip{display:flex; align-items:flex-start; gap:12px; padding:16px 18px;
    border-radius:14px; background:var(--sunk); border:1px solid var(--hair2);}
  .note-strip .ic{width:16px; height:16px; color:var(--mist); margin-top:1px;}
  .note-strip__text{flex:1 1 0; min-width:0; font-size:12px; line-height:18px; color:var(--mist);}

  /* Steps */
  .step{display:flex; align-items:flex-start; gap:16px; padding:20px; border-radius:14px;
    background:var(--card2); border:1px solid var(--hair2);}
  .step--highlight{border-color:var(--edge-accent2);}
  .step--warn{background:var(--warn-bg); border-color:var(--warn-edge);}
  .step__num{width:38px; height:38px; flex-shrink:0; border-radius:999px; display:flex;
    align-items:center; justify-content:center;
    background:#0D1F26; border:1px solid var(--edge-accent2); color:var(--cyan);}
  .step__num .ic{width:16px; height:16px;}
  .step__num--ok{background:var(--ok-bg); border-color:var(--ok-edge); color:var(--ok);}
  .step__num--info{background:#0F1A2A; border-color:#2B4A66; color:var(--brand);}
  .step__num--warn{background:#241C10; border-color:#5B4726; color:var(--warn);}
  .step__col{flex:1 1 0; min-width:0; display:flex; flex-direction:column; gap:9px;}
  .step__title{font-size:15px; font-weight:700; line-height:18px;}
  .step__text{font-size:13px; line-height:20px; color:var(--mist);}
  .step--warn .step__text{color:var(--warn-ink);}
  .step__field{display:flex; flex-direction:column; gap:8px; margin-top:4px; padding:14px 16px;
    border-radius:12px; background:var(--sunk); border:1px solid var(--hair2);}
  .step__field-label{font-family:var(--mono); font-size:10px; line-height:12px;
    letter-spacing:.12em; color:var(--mist);}
  .step__field-value{font-family:var(--mono); font-size:17px; line-height:24px; color:#C8D4E3;
    word-break:break-all; user-select:all;}
  .conf-list{display:flex; flex-direction:column; gap:8px; padding-top:4px;}
  .conf-row{display:flex; align-items:center; gap:12px; min-height:40px; padding:8px 14px;
    border-radius:11px; background:var(--card2); border:1px solid var(--hair2);
    text-align:left; width:100%; text-decoration:none;}
  .conf-row:hover{border-color:var(--edge-accent2);}
  .conf-row__name{flex:1 1 0; min-width:0; font-size:13px; font-weight:500; line-height:16px;
    color:var(--snow); white-space:nowrap; overflow:hidden; text-overflow:ellipsis;}
  .conf-row__file{font-family:var(--mono); font-size:12px; line-height:16px; color:var(--mist);}

  .empty{color:var(--mist); font-size:13px; padding:6px 2px;}

  /* AmneziaWG keys. The card repeats "Set up": same heading, same server
     control. Two selectors behaving differently on one page is a cost the
     reader pays. */
  .scan{display:flex; flex-direction:column; gap:18px;}
  .scan .install__title{font-size:20px;}
  /* One thing in two forms, so one block with two halves, the way the header
     pair is built. Two separate buttons would read as two actions. */
  .seg-group{display:flex; gap:4px; padding:4px; border-radius:13px;
    background:var(--card2); border:1px solid var(--hair);}
  .seg-btn{flex:1 1 0; min-width:0; height:36px; border-radius:10px;
    display:flex; align-items:center; justify-content:center;
    font-size:13px; font-weight:500; color:#C8D4E3; border:1px solid transparent;}
  .seg-btn:hover{color:var(--snow);}
  .seg-btn.is-on{background:var(--cyan-bg); border-color:var(--edge-accent); color:var(--cyan);}

  /* Compact import widget: segmented selectors + one QR shown at a time. */
  .segs{display:flex; flex-wrap:wrap; gap:5px; margin-bottom:12px;}
  .seg{cursor:pointer; background:var(--ground2); border:1px solid var(--hair); color:var(--mist);
    border-radius:8px; padding:7px 13px; font-size:12px; font-family:var(--mono); font-weight:500;
    transition:color .15s, border-color .15s, background .15s;}
  .seg:hover{color:var(--snow);}
  .seg.on{color:var(--ground); background:var(--cyan2); border-color:var(--cyan2);}
  .appsel{margin-top:-6px;}
  /* min-height reserves the QR row so switching target/app never reflows the page. */
  .qrview{display:flex; justify-content:center; min-height:286px;}
  .qrf{display:none; margin:0; flex-direction:column; align-items:center; text-align:center;}
  .qrf.on{display:flex; animation:fade .25s ease both;}
  /* No script, no way to switch: show every code, each under its own caption,
     rather than one code and no route to the others. */
  .nojs .qrf{display:flex;}
  .nojs .qrview{flex-wrap:wrap; gap:18px;}
  .qbx{background:#fff; border-radius:12px; padding:11px; line-height:0;
    max-width:100%; box-sizing:border-box;
    box-shadow:0 1px 0 rgba(255,255,255,.05), 0 10px 28px rgba(0,0,0,.4);}
  /* The width comes from the drawer as an attribute, by module count (at least
     3 px a module, 240 to 520 px, see qrSidePx). A fixed 240 here put a
     129-module AmneziaVPN key under 2 px a module and no phone read it. The
     container's width is the ceiling on a narrow screen. */
  .qbx svg{display:block; max-width:100%; height:auto;}
  /* What stands in the code's place until the browser has drawn it, and
     forever if it never does. The box keeps its width so the page does not
     jump when the code lands, and the text is the substance: a link or a whole
     config, selectable, on the white the code would have used. */
  .qbx__fallback{display:none;}
  .qbx[data-qr-pending] .qbx__fallback{display:block; width:240px; max-width:100%;
    line-height:16px; text-align:left;}
  .qbx__text{display:block; font-family:var(--mono); font-size:11px; color:#101418;
    word-break:break-all; white-space:pre-wrap; max-height:200px; overflow:auto;}
  .qbx__note{display:block; margin-top:8px; font-size:11px; line-height:15px; color:#5A6672;}
  .qr-plate .qbx[data-qr-pending] .qbx__fallback{width:300px;}
  .qrf figcaption{color:var(--mist); font-size:11px; margin-top:10px; font-family:var(--mono);}
  .copyk{display:inline-block; margin-top:10px; cursor:pointer; font-size:12px; font-weight:500; text-decoration:none;
    border:1px solid var(--hair); background:var(--ground2); color:var(--cyan);
    border-radius:8px; padding:7px 14px;}
  .copyk:hover{border-color:var(--cyan2);}
  /* Downloads. The card reuses the "all apps" expander, so it carries no
     machinery of its own; --flat drops the inner plate, which would otherwise
     be a box inside a box. */
  .all-apps--flat{padding:0; background:none; border:0;}
  /* Та же утопленная плашка, что и «все приложения»: блок живёт внутри
     карточки «Установка», а не рядом с ней, в том числе когда выдавать нечего
     и на её месте стоит объяснение. */
  .dl-card{padding:18px; border-radius:14px; background:var(--sunk); border:1px solid var(--hair2);}
  .dl-mark{width:17px; height:17px; color:var(--mist);}
  .note-strip__title{color:var(--snow); font-weight:700;}
  /* Кнопки шага. Без них ссылка рисовалась подчёркнутым текстом браузера и
     читалась как сноска, а не как то, что надо нажать. */
  .step__buttons{display:flex; flex-wrap:wrap; gap:10px; padding-top:4px;}
  .step-btn{display:inline-flex; align-items:center; gap:9px; height:36px; padding:0 14px;
    border-radius:11px; background:var(--cyan-bg); border:1px solid var(--edge-accent2);
    font-size:13px; font-weight:500; color:var(--cyan); text-decoration:none; white-space:nowrap;}
  .step-btn:hover{border-color:var(--edge-accent);}
  .step-btn .ic{width:13px; height:13px;}
  .step-btn b{font-weight:700;}
  /* Свёрнуто подпись говорит, зачем блок вообще. Раскрыто она уже сказана
     самим списком, и её место занимает то, что нужно ЗДЕСЬ: что значит точка. */
  .all-apps.is-open .dl-note--shut{display:none;}
  .all-apps:not(.is-open) .dl-note--open{display:none;}
  /* В мёртвом состоянии подсказка про точку врала бы: строк нет, отмечать
     нечего. Возвращается обычная подпись, объясняющая, зачем блок вообще. */
  .all-apps.is-dead .dl-note--open{display:none;}
  .all-apps.is-dead .dl-note--shut{display:block;}
  /* Предупреждение про пароли в конфиге тоже ни к чему, когда конфигов не
     выдают. */
  .all-apps.is-dead .dl-warn{display:none;}
  /* Предупреждение про пароли стоит под списком, а не над ним: сверху его
     читают до того, как есть что забирать, и оно превращается в шум. */
  .dl-warn{margin-top:2px;}
  .dl-dead{display:flex; align-items:flex-start; gap:9px; padding:12px 14px; border-radius:12px;
    background:var(--bad-bg); border:1px solid var(--bad-edge); color:var(--bad);
    font-size:12px; line-height:17px;}
  .dl-dead .ic{width:14px; height:14px; margin-top:2px;}
  .dl-groups{display:flex; flex-direction:column; gap:16px;}
  .dl-group{display:flex; flex-direction:column; gap:8px;}
  .dl-row{display:flex; align-items:center; gap:12px; flex-wrap:wrap; padding:12px 14px;
    border-radius:12px; background:var(--card2); border:1px solid var(--hair2);}
  .dl-row__col{flex:1 1 220px; min-width:0; display:flex; flex-direction:column; gap:3px;}
  .dl-row__actions{display:flex; gap:8px; flex-shrink:0;}
  .dl-row__name{display:flex; align-items:center; gap:8px; font-size:14px; font-weight:600;
    line-height:18px; color:var(--snow);}
  .dl-row__note{font-size:12px; line-height:16px; color:var(--mist);}
  .dl-row__note--warn{color:var(--warn);}
  /* The four HTTP-proxy fields Telegram Desktop asks for, selectable. */
  .dl-row__field{display:inline-block; margin:4px 12px 0 0;}
  .dl-row__field code{font-family:var(--mono); color:var(--cyan); word-break:break-all;}
  /* Точка отмечает то, что подходит выбранной платформе. Строк это не
     убавляет: место под точку держится всегда, иначе имена дёргались бы влево
     и вправо при каждом переключении платформы. */
  .dl-row__dot{width:6px; height:6px; flex-shrink:0; border-radius:999px; background:transparent;}
  .dl-row.is-fit{background:var(--cyan-bg); border-color:var(--edge-accent);}
  .dl-row.is-fit .dl-row__dot{background:var(--cyan);}
  /* Ровный вид у обеих кнопок, а бирюзу получает только строка, отмеченная
     точкой: акцент на КАЖДОЙ строке перестаёт быть акцентом, а отмечена та,
     что подходит выбранной платформе. Приглушённая кнопка остаётся рабочей,
     это не «выключено». */
  .dl-btn{display:inline-flex; align-items:center; gap:8px; height:34px; padding:0 13px;
    border-radius:10px; background:var(--tile); border:1px solid var(--hair2);
    font-size:13px; font-weight:500; color:#C8D4E3; text-decoration:none; white-space:nowrap;}
  .dl-btn .ic{width:13px; height:13px;}
  .dl-btn--ghost{background:var(--card2); border-color:var(--hair2); color:var(--mist);}
  .dl-row.is-fit .dl-btn:not(.dl-btn--ghost){background:var(--cyan-bg);
    border-color:var(--edge-accent2); color:var(--cyan);}
  .dl-btn:hover{border-color:var(--edge-accent);}
  /* The chosen platform lifts its group to the top and tints its title. It
     never removes a group: taking a config file is what people do FOR another
     device, so hiding by platform hides exactly the row they came for. */
  .dl-group.is-relevant{order:-1;}
  .dl-group.is-relevant .all-apps__group-title{color:var(--cyan);}
  .hint{color:var(--mist); font-size:12px; margin-top:10px;}

  .support{display:block; text-align:center; margin-top:6px; color:var(--cyan); text-decoration:none;
    font-family:var(--mono); font-size:12px;}

  /* Transfer: a window on a desktop, a sheet from the bottom on a phone. The
     top corner is out of thumb reach, and a sheet leaves the page visible
     behind it so it is obvious nothing was navigated away from. */
  .overlay{position:fixed; inset:0; z-index:80; display:none;
    align-items:center; justify-content:center; padding:24px; background:rgba(4,8,13,.78);}
  .overlay.is-open{display:flex;}
  .modal{width:100%; max-width:460px; max-height:calc(100vh - 48px); overflow:auto;
    display:flex; flex-direction:column; gap:18px; padding:26px;
    border-radius:20px; background:var(--card); border:1px solid var(--hair2);}
  .modal__handle{display:none;}
  .modal__head{display:flex; align-items:flex-start; gap:12px;}
  .modal__col{flex:1 1 0; min-width:0; display:flex; flex-direction:column; gap:7px;}
  .modal__title{font-size:19px; font-weight:600; line-height:24px;}
  .modal__note{font-size:13px; line-height:19px; color:var(--mist);}
  .modal__close{width:32px; height:32px; flex-shrink:0; display:flex; align-items:center;
    justify-content:center; border-radius:9px; background:var(--card2);
    border:1px solid var(--hair); color:var(--mist);}
  .modal__close .ic{width:16px; height:16px;}
  .qr-plate{display:flex; align-items:center; justify-content:center; padding:28px;
    border-radius:16px; background:#E9EEF4;}
  .qr-plate svg{width:300px; height:300px; max-width:100%; display:block;}
  /* The one line the refusal page adds under the link: it answers "will I get
   a new address" where the address is. Muted, because it is a reassurance
   and not an instruction. */
.dead-note{margin-top:10px; font-size:12px; line-height:17px; color:var(--faint);}
.link-box{display:flex; flex-direction:column; gap:5px; padding:11px 14px; border-radius:12px;
    background:var(--card2); border:1px solid var(--hair);}
  .link-box__label{font-family:var(--mono); font-size:10px; line-height:12px;
    letter-spacing:.09em; color:var(--mist);}
  .link-box__value{font-family:var(--mono); font-size:13px; line-height:17px; color:var(--snow);
    word-break:break-all; user-select:all;}
  .modal__copy{display:flex; align-items:center; justify-content:center; gap:9px; height:44px;
    border-radius:12px; background:#14302F; border:1px solid #2C5C57;
    font-size:14px; font-weight:600; color:var(--cyan);}
  .modal__warn{display:flex; align-items:flex-start; gap:9px; font-size:12px; line-height:17px; color:var(--warn);}
  .modal__warn .ic{width:14px; height:14px; margin-top:2px;}

  /* Foot. The language switch lives here now: it is a once-per-visit decision
     and it was taking the top right corner, where the two buttons belong. Two
     plain links to ?lang=, so switching is a server re-render and needs no JS. */
  .foot{display:flex; justify-content:center; gap:7px; padding:34px 16px 52px;}
  .lang{display:flex; align-items:center; gap:7px; height:38px; padding:0 15px;
    border-radius:999px; background:var(--card2); border:1px solid var(--hair2);}
  .lng{text-decoration:none; color:#C8D4E3; font-size:13px; font-weight:600;
    letter-spacing:.02em; transition:color .15s;}
  .lng:hover{color:var(--snow);}
  .lng.on{color:var(--cyan);}
  .lang__sep{color:var(--faint);}

  /* Staggered load */
  .card,.top{animation:rise .5s ease both;}
  .top{animation-delay:.02s}
  .wrap>.card:nth-of-type(1){animation-delay:.06s}
  .wrap>.card:nth-of-type(2){animation-delay:.10s}
  .wrap>.card:nth-of-type(3){animation-delay:.14s}
  .wrap>.card:nth-of-type(4){animation-delay:.18s}
  .wrap>.card:nth-of-type(5){animation-delay:.22s}
  @keyframes rise{from{opacity:0; transform:translateY(10px)}to{opacity:1; transform:none}}
  /* ───── Телефон ─────
     Одна колонка везде, где на широком их четыре или две, и кнопки строки
     уезжают под её текст во всю ширину: на 390 они иначе рвут строку пополам
     и имя формата обрезается на середине слова. */
  @media (max-width:720px){
    .wrap{gap:18px; padding:0 16px;}
    .head{gap:14px; padding:20px 16px 18px;}
    .head__title{font-size:17px; line-height:22px;}
    .head__actions{gap:8px;}
    .hbtn{height:36px; border-radius:10px; font-size:12px; gap:7px;}
    .hbtn__full{display:none;}
    .hbtn__short{display:inline;}
    .card{padding:17px; border-radius:16px;}
    .sub-card{gap:16px;}
    .sub-card__head{gap:12px;}
    .sub-card__badge{width:38px; height:38px;}
    .sub-card__name{font-size:17px; line-height:22px;}
    .sub-card__row{flex-direction:column;}
    .tile{height:auto; min-height:66px; padding:11px 13px; gap:5px; border-radius:12px;}
    .tile__value{font-size:14px; line-height:18px;}
    .install__head{flex-wrap:wrap; gap:10px;}
    .install__title{font-size:18px;}
    .apps__row,.all-apps__row{grid-template-columns:minmax(0, 1fr);}
    .app-card{height:50px;}
    .spacer{display:none;}
    /* Иначе «Показать» ломается пополам: заголовку с названием платформы и
       счётчику на 390 не остаётся места, и переключатель ужимается до буквы. */
    .all-apps__line{flex-wrap:wrap;}
    .all-apps__toggle{white-space:nowrap;}
    .tg-row__col{padding-right:70px;}
    .step{padding:16px; gap:12px;}
    .step__num{width:34px; height:34px;}
    .step__field-value{font-size:14px; line-height:20px;}
    .linkrow{flex-direction:column; align-items:stretch; gap:8px;}
    .linkrow .copy{width:100%;}
    .dl-card{padding:14px;}
    .dl-row{align-items:stretch; flex-direction:column; gap:10px; padding:11px 12px;}
    .dl-row__col{flex:0 0 auto;}
    .dl-btn{flex:1 1 0; min-width:0; justify-content:center; height:34px; padding:0 10px;}
    .foot{padding:22px 16px 34px;}
    /* Шторка снизу вместо окна по центру: до верхнего угла большим пальцем не
       дотянуться, а из-под шторки видно, что страница на месте. */
    .overlay{align-items:flex-end; justify-content:center; padding:0;}
    .modal{max-width:none; border-radius:22px 22px 0 0; border-left:0; border-right:0;
      border-bottom:0; padding:10px 20px 26px; gap:16px; align-items:center; max-height:92vh;}
    .modal__handle{display:block; width:38px; height:4px; border-radius:2px;
      background:var(--hair2); flex-shrink:0; margin-bottom:6px;}
    .modal__head,.link-box,.modal__copy,.modal__warn{width:100%;}
    .qr-plate{width:100%; padding:20px;}
    .qr-plate svg{width:262px; height:262px;}
    .modal__title{font-size:17px; line-height:22px;}
  }


  body.active-sub {
    --ground:#05070a; --card:#0b0f13; --sunk:#05070a; --hair:#1c2430;
    --snow:#f2f3ee; --mist:#a3adb8; --faint:#8893a0; --cyan:#a8e6ff;
    --edge-accent:#a8e6ff73; --cyan-bg:#f2f3ee0f; --sans:system-ui,sans-serif;
    background:radial-gradient(ellipse 46% 44% at 0 0,#8cd7ff33,#8cd7ff15 35%,#8cd7ff06 65%,transparent),var(--ground);
    font:13px/18px var(--sans);
  }
  .active-sub::before {display:none}
  .active-sub .page {width:min(1088px,calc(100% - 32px));margin:auto;align-items:stretch}
  .active-sub .stopped-head {width:100%}
  .stopped-head nav {z-index:5;white-space:nowrap}
  .stopped-head .lng {height:auto;padding:4px 10px;background:none;border:0;text-decoration:none}
  .active-layout.wrap {width:100%;max-width:none;padding:0 0 40px;display:grid;grid-template-columns:372px minmax(0,1fr);grid-template-rows:auto auto 1fr;gap:20px;align-items:start}
  .active-layout > * {min-width:0}
  .active-layout .card,.active-tools {border:1px solid var(--hair);border-radius:14px;background:var(--card);box-shadow:none}
  .active-layout .sub-card {grid-area:1/1;display:flex;flex-direction:column;gap:14px;padding:16px}
  .active-layout .install {grid-area:1/2/span 3;gap:16px;padding:20px 24px 24px}
  .active-layout .scan {grid-column:2;grid-row:4;padding:20px 24px}
  .active-layout .active-tools {grid-area:2/1;overflow-wrap:anywhere;min-width:0}
  .active-badge {display:inline-flex;align-items:center;gap:6px;color:var(--snow)}
  .active-badge::before {content:'';width:7px;height:7px;border-radius:50%;background:var(--cyan)}
  .active-badge.sub-card__note--warn::before {background:var(--warn)}
  .active-warning {color:var(--warn);margin:0}
  .active-usage progress {display:block;appearance:none;width:100%;height:4px;margin:8px 0 0;overflow:hidden;border:0;border-radius:4px;background:var(--hair2)}
  .active-usage progress::-webkit-progress-bar {background:var(--hair2)}
  .active-usage progress::-webkit-progress-value {background:var(--cyan)}
  .active-usage progress.low::-webkit-progress-value {background:var(--warn)}
  .active-usage progress::-moz-progress-bar {background:var(--cyan)}
  .active-layout .head__actions {display:flex;flex-direction:row;gap:8px;width:100%;padding:0;border:0;background:none}
  .active-layout .hbtn {flex:1 1 0;min-width:0;height:40px;justify-content:center;border:1px solid #f2f3ee3d;border-radius:10px;background:transparent;color:var(--snow);font:600 13px/18px var(--sans);padding:0 5px}
  .active-layout .hbtn--qr::after {display:none}
  .active-layout .install__title {font:600 18px/24px var(--sans);margin:0}
  .active-layout .install__head {display:flex;align-items:flex-start;flex-direction:column;gap:14px}
  .active-tools .dl-card {margin:0;padding:14px 16px;border:0;background:none}
  .active-tools .support,.active-link {display:block;margin:0;border-top:1px solid var(--hair);padding:14px 16px;border-radius:0;color:var(--snow);font:500 13px/18px var(--sans);text-decoration:none}
  .active-link summary {cursor:pointer}
  .active-link[open] .linkrow {margin:8px 0 0}
  .active-tools .all-apps__title {font-size:14px}
  .active-layout .app-card {height:52px;gap:8px;overflow:hidden;border-radius:10px;padding:0 10px;color:var(--snow);background:var(--sunk)}
  .active-layout .app-card.is-on {background:var(--cyan-bg)}
  .active-layout .app-card__mark {position:static;order:-2;width:22px;height:22px;opacity:1;transform:none;display:flex;align-items:center}
  .active-layout .app-card__mark svg {width:22px;height:22px}
  .active-layout .app-card__dot,.active-layout .app-card__glyph {display:none}
  .active-layout .connect-steps {counter-reset:step;display:grid;grid-template-columns:repeat(auto-fit,minmax(min(134px,100%),1fr));gap:14px;border-top:1px solid var(--hair);padding-top:18px}
  .active-layout .step {counter-increment:step;display:flex;flex-direction:column;align-items:stretch;gap:8px;min-width:0;padding:0;border:0;border-radius:0;background:none}
  .active-layout .step__num {width:24px;height:24px;font:500 12px/18px var(--sans);background:transparent;color:var(--snow);border:1px solid var(--hair2)}
  .active-layout .step__num::before {content:counter(step)} .active-layout .step__num svg {display:none}
  .active-layout .step__title {font:600 14px/20px var(--sans)}
  .active-layout .step__text {font:13px/18px var(--sans)}
  .active-layout .step-btn {width:100%;max-width:100%;height:auto;min-height:36px;white-space:normal}
  @media(min-width:961px){
    .active-layout .install [data-platform-picker] {width:100%}
    .active-layout .install [data-platform-btn] {display:none}
    .active-layout .install [data-platform-picker] .platform__menu {display:flex;position:static;flex-direction:row;align-items:center;gap:2px;min-width:0;width:100%;padding:3px;border:1px solid var(--hair);border-radius:10px;background:var(--sunk);box-shadow:none}
    .active-layout .install [data-platform-picker] .platform__item {flex:1 1 auto;min-width:0;justify-content:center;white-space:normal;padding:3px 4px;line-height:14px}
    .active-layout .install [data-platform-picker] .platform__item svg {display:none}
  }
  @media(max-width:960px){
    .active-layout.wrap {display:flex;flex-direction:column;align-items:stretch;gap:12px;padding-bottom:24px}
    .active-layout .install,.active-layout .scan {padding:16px}
    .active-layout .sub-card {order:0}.active-layout .install {order:1}.active-layout .scan {order:2}.active-layout .active-tools {order:3}
    .active-layout .install__head {flex-direction:row;align-items:center;justify-content:space-between}
    .active-layout .install__title {font-size:16px;line-height:22px}
  }
  @media(max-width:600px){
    .active-sub {background-size:auto}
    .active-layout .apps__row,.active-layout .all-apps__row {grid-template-columns:repeat(2,minmax(0,1fr));gap:8px}
    .active-layout .connect-steps {grid-template-columns:1fr}
    .active-layout .step {display:grid;grid-template-columns:24px minmax(0,1fr);gap:12px}
    .active-layout .hbtn__full {display:inline}.active-layout .hbtn__short {display:none}
    .active-layout .head__actions {gap:6px}
  }


  .active-sub > .sprite {position:absolute;display:block;pointer-events:none}
  .active-date {font-weight:400;color:var(--mist);white-space:nowrap}
  .active-sub .apps-guide {margin:0;font:13px/18px var(--sans);color:var(--mist)}
  .step__help {display:block;font-size:12px;line-height:16px;margin-top:8px;color:var(--faint)}
  .active-link[open] .protos {margin:8px 0}
  .telegram-tools {padding:14px 16px;border-bottom:1px solid var(--hair)}
  .telegram-tools summary {display:flex;align-items:center;gap:10px;font-weight:600;cursor:pointer}
  .telegram-tools summary::after {content:'⌄';margin-left:auto;color:var(--mist)}
  .telegram-tools summary small {display:block;font-size:12px;font-weight:400;color:var(--mist)}
  .telegram-tools[open] .dl-row {margin-top:10px}
  .active-layout .platform__menu [data-pick=windows] {order:0}
  .active-layout .platform__menu [data-pick=macos] {order:1}
  .active-layout .platform__menu [data-pick=linux] {order:2}
  .active-layout .platform__menu [data-pick=ios] {order:3}
  .active-layout .platform__menu [data-pick=android] {order:4}
  .active-layout .platform__menu [data-pick=androidtv] {order:5}
  .active-layout .platform__menu [data-pick=appletv] {order:6}
  .active-layout .platform__menu [data-pick=router] {order:7}
  @media (prefers-reduced-motion:reduce){*{animation:none!important}}
`;
