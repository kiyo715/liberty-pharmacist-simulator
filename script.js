/* ══════════════════════════════════════════
   薬剤師 適正時給シミュレーター — Logic
   データ根拠: 日本薬剤師会調査(2025年12月)、マイナビ薬剤師都道府県別年収
══════════════════════════════════════════ */

/* ══ 匿名データ収集 ══
   Google Apps Script Web App の URL をここに貼り付け
   設定方法: gas_setup.js の手順を参照
══════════════════════════════════════════ */
const SHEET_ENDPOINT = "https://script.google.com/macros/s/AKfycbxs71LVUGoFFCe0Wp_jM52w7B8aSuMUX9OwDV8qQiiG-pjgO7jQ5Hyr3W6UevCE2orW/exec";

const yen = new Intl.NumberFormat("ja-JP");
const WEEKS_PER_YEAR  = 52;
const MONTHS_PER_YEAR = 12;

/* ── DOM references ── */
const form   = document.querySelector("#wageForm");
const fields = {
  currentWage:  form.querySelector("#currentWage"),
  payLabel:     form.querySelector("#payLabel"),
  payUnit:      form.querySelector("#payUnit"),
  payHelp:      form.querySelector("#payHelp"),
  employment:   form.querySelector("#employment"),
  area:         form.querySelector("#area"),
  workplace:    form.querySelector("#workplace"),
  experience:   form.querySelector("#experience"),
  shift:        form.querySelector("#shift"),
  weeklyHours:  form.querySelector("#weeklyHours"),
  hoursHelp:    form.querySelector("#hoursHelp"),
  solo:         form.querySelector("#solo"),
  homecare:     form.querySelector("#homecare"),
  leadership:   form.querySelector("#leadership"),
};

const out = {
  rangeText:           document.querySelector("#rangeText"),
  resultSublabel:      document.querySelector("#resultSublabel"),
  statusBadge:         document.querySelector("#statusBadge"),
  marker:              document.querySelector("#marker"),
  summaryText:         document.querySelector("#summaryText"),
  diffText:            document.querySelector("#diffText"),
  diffLabel:           document.querySelector("#diffLabel"),
  convertedHourlyText: document.querySelector("#convertedHourlyText"),
  hourlyLabel:         document.querySelector("#hourlyLabel"),
  monthlyText:         document.querySelector("#monthlyText"),
  monthlyLabel:        document.querySelector("#monthlyLabel"),
  yearlyText:          document.querySelector("#yearlyText"),
  yearlyLabel:         document.querySelector("#yearlyLabel"),
  annualImpact:        document.querySelector("#annualImpact"),
  annualImpactValue:   document.querySelector("#annualImpactValue"),
  annualImpactLabel:   document.querySelector("#annualImpactLabel"),
  annualImpactSub:     document.querySelector("#annualImpactSub"),
  breakdownList:       document.querySelector("#breakdownList"),
  adviceList:          document.querySelector("#adviceList"),
  resultCard:          document.querySelector("#resultCard"),
};

/* ══════════════════════════════════════════
   Data — wage model
   地域補正根拠:
     東京23位、大阪36位（マイナビ薬剤師都道府県別年収）
     首都圏は薬剤師充足で相場低め
     熊本1位(761.8万)、広島2位(715.7万)など採用難地域が高い
   業態補正根拠:
     調剤薬局596万、ドラッグストア594万、病院542万（マイナビ薬剤師）
══════════════════════════════════════════ */
const BASE = {
  part:    2200,   // パート中央値（求人媒体集計）
  temp:    2900,   // 派遣（相場2,500〜3,000円以上の中間）
  regular: 2750    // 正社員換算（全国平均年収572万円ベース、週40h換算）
};

const MOD = {
  area: {
    metro:    -50,   // 首都圏・大都市: 充足で相場低め（東京23位）
    urban:    +50,   // 地方都市: 首都圏より高め（広島2位・新潟4位）
    shortage: +450   // 採用難・へき地: 大幅プレミアム（熊本1位）
  },
  workplace: {
    pharmacy_mae: +80,   // 門前薬局: 処方量多く単価高め
    pharmacy:       0,   // 調剤薬局一般: 基準（年収596万）
    drugstore:    +50,   // ドラッグストア: OTC兼務手当（年収594万）
    hospital:    -120    // 病院直営: 安定・福利分低め（年収542万、差-54万）
  },
  experience: {
    year1to2:  -200,   // 1〜2年目
    year3to4:  -100,   // 3〜4年目
    year5to6:   +50,   // 5〜6年目: 即戦力評価
    year7to8:  +100,   // 7〜8年目
    year9to10: +150,   // 9〜10年目
    year11plus:+200    // 11年目以降: 熟練・専門性
  },
  shift: {
    weekday_part:  +30,  // 平日パート（昼・夕方）: 基準
    weekend:      +180,  // 土日祝: 需要高い枠
    flexible:     +320,  // 夜間・土日両対応
    fullDay:         0   // 正社員1日: シフト割増なし
  }
};

const CAP_MOD = { solo: 150, homecare: 130, leadership: 110 };

// 雇用形態別のレンジ幅（不確実性の差を表現）
const SPREAD = {
  part:    { lo: 180, hi: 220 },
  temp:    { lo: 150, hi: 180 },
  regular: { lo: 200, hi: 280 }
};

const LABELS = {
  employment: { part: "パート・アルバイト", temp: "派遣", regular: "正社員" },
  area: {
    metro:    "首都圏・大都市中心部",
    urban:    "地方都市・郊外",
    shortage: "採用難地域・へき地"
  },
  workplace: {
    pharmacy_mae: "門前薬局（大病院前）",
    pharmacy:     "調剤薬局（一般）",
    drugstore:    "ドラッグストア・OTCあり",
    hospital:     "病院・クリニック直営"
  },
  shift: {
    weekday_part: "平日パート（昼・夕方）",
    weekend:      "土日祝あり",
    flexible:     "夜間・土日対応可",
    fullDay:      "1日勤務"
  }
};

let prevEmployment = fields.employment.value;

/* ══════════════════════════════════════════
   Core calculation
══════════════════════════════════════════ */
function calculate() {
  const emp     = fields.employment.value;
  const area    = fields.area.value;
  const work    = fields.workplace.value;
  const exp     = fields.experience.value;
  const shift   = fields.shift.value;
  const wkHours = Number(fields.weeklyHours.value) || 0;
  const current = toHourly(emp, wkHours);

  /* Build factor list — || 0 でNaN防止 */
  const factors = [
    { label: `雇用形態（${LABELS.employment[emp] ?? emp}）`,                             val: BASE[emp] || 0,              isBase: true },
    { label: `地域（${LABELS.area[area] ?? area}）`,                                     val: MOD.area[area] ?? 0 },
    { label: `業態（${LABELS.workplace[work] ?? work}）`,                                val: MOD.workplace[work] ?? 0 },
    { label: `経験（${fields.experience.options[fields.experience.selectedIndex].text}）`, val: MOD.experience[exp] ?? 0 },
    { label: `シフト（${LABELS.shift[shift] ?? shift}）`,                                val: MOD.shift[shift] ?? 0 }
  ];

  if (fields.solo.checked)       factors.push({ label: "一人薬剤師対応",     val: CAP_MOD.solo });
  if (fields.homecare.checked)   factors.push({ label: "在宅・施設訪問対応", val: CAP_MOD.homecare });
  if (fields.leadership.checked) factors.push({ label: "管理薬剤師補助",     val: CAP_MOD.leadership });

  const mid    = factors.reduce((s, f) => s + f.val, 0);
  const sp     = SPREAD[emp];
  const minW   = roundTo50(mid - sp.lo);
  const maxW   = roundTo50(mid + sp.hi);
  const diff   = current - mid;

  /* Gauge needle position (0-100%)
     ratio=0 → needle at 33% (left edge of green "fair" zone)
     ratio=1 → needle at 67% (right edge of green zone)
     ratio<0 → red zone, ratio>1 → amber zone               */
  const ratio    = clamp((current - minW) / (maxW - minW), -1.0, 2.0);
  const markerPc = clamp(33.33 + ratio * 33.33, 2, 98);

  /* Income */
  const annHours = wkHours * WEEKS_PER_YEAR;
  const yearly   = emp === "regular"
    ? Number(fields.currentWage.value) * 10000
    : current * annHours;
  const monthly  = yearly / MONTHS_PER_YEAR;

  /* Status */
  const status = getStatus(current, minW, maxW);

  out.marker.style.left          = `${markerPc}%`;
  out.statusBadge.className      = `status-badge${status.cls}`;
  out.statusBadge.textContent    = status.label;
  out.resultCard.dataset.status  = status.key;

  /* ── 正社員：年収モード表示 ── */
  if (emp === "regular") {
    const toMan = (h) => Math.round(h * annHours / 10000);   // 時給→万円
    const annMin = toMan(minW);
    const annMax = toMan(maxW);
    const annMid = toMan(mid);
    const entered = Number(fields.currentWage.value) || 0;   // 万円
    const annDiffMon = entered - annMid;                     // 万円差
    const sign = annDiffMon >= 0 ? "+" : "";

    out.resultSublabel.textContent = "推定適正年収レンジ";
    out.rangeText.textContent      = `${yen.format(annMin)}〜${yen.format(annMax)}万円`;

    out.diffLabel.textContent    = "中央値との差（年収）";
    out.hourlyLabel.textContent  = "換算時給（参考）";
    out.monthlyLabel.textContent = "現在の月収目安";
    out.yearlyLabel.textContent  = "推定適正年収（中央値）";

    setMetric(out.diffText,            `${sign}${yen.format(annDiffMon)}万円`);
    setMetric(out.convertedHourlyText, `${yen.format(roundTo50(current))}円/h`);
    setMetric(out.monthlyText,         `${yen.format(Math.round(entered * 10000 / 12 / 1000) * 1000)}円`);
    setMetric(out.yearlyText,          `${yen.format(annMid)}万円`);

    out.summaryText.textContent = buildSummaryReg(status.key, entered, annMid, annMin, annMax, current);
    renderAnnualImpactReg(annDiffMon);

  /* ── パート・派遣：時給モード表示 ── */
  } else {
    const annDiff = Math.round(diff * annHours / 10000) * 10000;
    const sign    = diff >= 0 ? "+" : "";

    out.resultSublabel.textContent = "推定適正時給レンジ";
    out.rangeText.textContent      = `${yen.format(minW)}〜${yen.format(maxW)}円`;

    out.diffLabel.textContent    = "中央値との差（時給）";
    out.hourlyLabel.textContent  = "現在の換算時給";
    out.monthlyLabel.textContent = "月収目安";
    out.yearlyLabel.textContent  = "年収目安";

    setMetric(out.diffText,            `${sign}${yen.format(roundTo50(diff))}円`);
    setMetric(out.convertedHourlyText, `${yen.format(roundTo50(current))}円`);
    setMetric(out.monthlyText,         `${yen.format(Math.round(monthly / 1000) * 1000)}円`);
    setMetric(out.yearlyText,          `${yen.format(Math.round(yearly / 10000) * 10000)}円`);

    out.summaryText.textContent = buildSummary(status.key, current, mid, minW, maxW);
    renderAnnualImpact(annDiff);
    renderAdvice(status.key, fields.solo.checked || fields.homecare.checked || fields.leadership.checked,
                 emp, area, shift, diff, annDiff);
  }

  if (emp === "regular") {
    const annDiffMon = (Number(fields.currentWage.value) || 0) - Math.round(mid * annHours / 10000);
    renderAdvice(status.key, fields.solo.checked || fields.homecare.checked || fields.leadership.checked,
                 emp, area, shift, diff, annDiffMon * 10000);
  }

  renderBreakdown(factors, mid);

  // 匿名データ送信（4秒デバウンス）
  scheduleDataSend(emp, area, workplace, experience, shift, wkHours, mid, status.key);
}

/* ── 匿名データ収集 ── */
let _dataTimer = null;
let _lastSentKey = "";

function scheduleDataSend(emp, area, work, exp, shift, wkHours, mid, statusKey) {
  clearTimeout(_dataTimer);
  _dataTimer = setTimeout(() => sendAnonymousData(emp, area, work, exp, shift, wkHours, mid, statusKey), 4000);
}

function sendAnonymousData(emp, area, work, exp, shift, wkHours, mid, statusKey) {
  if (!SHEET_ENDPOINT) return;

  const entered = Number(fields.currentWage.value) || 0;
  // 時給帯を100円単位・年収帯を50万円単位で匿名化
  const wageRange = emp === "regular"
    ? `${Math.floor(entered / 50) * 50}万円台`
    : `${Math.floor(entered / 100) * 100}〜${Math.floor(entered / 100) * 100 + 99}円`;

  const payload = {
    t:    new Date().toISOString(),
    emp, area, work, exp, shift,
    wh:   wkHours,
    solo: fields.solo.checked ? 1 : 0,
    hc:   fields.homecare.checked ? 1 : 0,
    lead: fields.leadership.checked ? 1 : 0,
    wr:   wageRange,
    mid:  roundTo50(mid),
    st:   statusKey,
  };

  const key = JSON.stringify(payload);
  if (key === _lastSentKey) return;
  _lastSentKey = key;

  setDataStatus("sending");
  fetch(`${SHEET_ENDPOINT}?${new URLSearchParams(payload)}`, { mode: "no-cors" })
    .then(() => setDataStatus("sent"))
    .catch(() => setDataStatus("idle"));
}

function setDataStatus(state) {
  const el = document.getElementById("dataStatusDot");
  if (el) el.className = `data-dot ${state}`;
}

/* ── Helpers ── */
function toHourly(emp, wkHours) {
  const v = Number(fields.currentWage.value) || 0;
  if (emp === "regular") return (v * 10000) / (Math.max(wkHours, 1) * WEEKS_PER_YEAR);
  return v;
}

function getStatus(cur, lo, hi) {
  if (cur < lo) return { key: "low",  label: "相場より低め", cls: " low" };
  if (cur > hi) return { key: "high", label: "相場より高め", cls: " high" };
  return             { key: "fair", label: "妥当レンジ内",   cls: "" };
}

function setMetric(el, text) {
  if (el.textContent === text) return;
  el.textContent = text;
  el.classList.remove("animate");
  requestAnimationFrame(() => el.classList.add("animate"));
}

function roundTo50(v) { return Math.round(v / 50) * 50; }
function clamp(v, lo, hi) { return Math.min(Math.max(v, lo), hi); }

/* ══════════════════════════════════════════
   Summary text — 時給モード（パート・派遣）
══════════════════════════════════════════ */
function buildSummary(status, cur, mid, lo, hi) {
  const curText = `時給 ${yen.format(cur)}円`;
  if (status === "low") {
    const gapMin = roundTo50(lo  - cur);
    const gapMid = roundTo50(mid - cur);
    return `${curText}は推定レンジ（${yen.format(lo)}〜${yen.format(hi)}円）を下回っています。` +
      `レンジ下限まで約 ${yen.format(gapMin)}円、中央値まで約 ${yen.format(gapMid)}円の差があります。` +
      `担当業務の実績を数字で整理し、給与改定の相談を検討しましょう。`;
  }
  if (status === "high") {
    return `${curText}は推定レンジ（${yen.format(lo)}〜${yen.format(hi)}円）の上限を超えています。` +
      `給与面は相場比で強い水準です。継続性・業務負荷・労働環境とのバランスも確認してください。`;
  }
  return `${curText}は推定レンジ（${yen.format(lo)}〜${yen.format(hi)}円）内に収まっています。` +
    `大きな乖離はありませんが、担当業務や対応シフトが増えた際には上振れ交渉の余地があります。`;
}

/* ══════════════════════════════════════════
   Summary text — 年収モード（正社員）
══════════════════════════════════════════ */
function buildSummaryReg(status, entered, annMid, annMin, annMax, hourly) {
  const curText = `年収 ${yen.format(entered)}万円（換算時給 ${yen.format(roundTo50(hourly))}円/h）`;
  const range   = `${yen.format(annMin)}〜${yen.format(annMax)}万円`;
  if (status === "low") {
    const gapMid = entered - annMid;   // 負の値（entered < mid）
    return `${curText}は推定年収レンジ（${range}）を下回っています。` +
      `推定中央値（${yen.format(annMid)}万円）まで約 ${yen.format(Math.abs(gapMid))}万円の差があります。` +
      `担当業務・勤務時間の実績を整理して給与改定を相談しましょう。`;
  }
  if (status === "high") {
    return `${curText}は推定年収レンジ（${range}）の上限を超えています。` +
      `給与面は相場比で強い水準です。業務負荷・労働環境とのバランスも確認してください。`;
  }
  return `${curText}は推定年収レンジ（${range}）内に収まっています。` +
    `大きな乖離はありませんが、担当業務範囲が増えた際には見直し交渉の余地があります。`;
}

/* ══════════════════════════════════════════
   Annual impact banner — 時給モード
══════════════════════════════════════════ */
function renderAnnualImpact(annDiff) {
  if (Math.abs(annDiff) < 10000) {
    out.annualImpact.style.display = "none";
    return;
  }
  const isNeg = annDiff < 0;
  const sign  = annDiff > 0 ? "+" : "";
  out.annualImpact.className         = `annual-impact ${isNeg ? "ai-neg" : "ai-pos"}`;
  out.annualImpact.style.display     = "";
  out.annualImpactLabel.textContent  = "年間インパクト（時給差 × 年間労働時間）";
  out.annualImpactSub.textContent    = "転職・交渉時の参考値";
  out.annualImpactValue.textContent  = `${sign}${yen.format(annDiff)}円/年`;
}

/* ══════════════════════════════════════════
   Annual impact banner — 年収モード（正社員）
══════════════════════════════════════════ */
function renderAnnualImpactReg(annDiffMon) {
  if (Math.abs(annDiffMon) < 10) {
    out.annualImpact.style.display = "none";
    return;
  }
  const isNeg = annDiffMon < 0;
  const sign  = annDiffMon > 0 ? "+" : "";
  out.annualImpact.className        = `annual-impact ${isNeg ? "ai-neg" : "ai-pos"}`;
  out.annualImpact.style.display    = "";
  out.annualImpactLabel.textContent = "年収差（現在 vs 推定適正中央値）";
  out.annualImpactSub.textContent   = "給与交渉・転職検討時の参考値";
  out.annualImpactValue.textContent = `${sign}${yen.format(annDiffMon)}万円/年`;
}

/* ══════════════════════════════════════════
   Breakdown bars
══════════════════════════════════════════ */
function renderBreakdown(factors, total) {
  const maxAbs = Math.max(
    ...factors.filter(f => !f.isBase).map(f => Math.abs(f.val)), 1
  );

  const rows = factors.map(f => {
    if (f.isBase) {
      return `<div class="bd-row">
        <span class="bd-label">${f.label}</span>
        <span class="bd-base-val">${yen.format(f.val)}円<span class="bd-base-note">（基準値）</span></span>
      </div>`;
    }
    if (f.val === 0) {
      return `<div class="bd-row">
        <span class="bd-label">${f.label}</span>
        <span class="bd-zero">± 0円</span>
      </div>`;
    }
    const pct  = (Math.abs(f.val) / maxAbs * 100).toFixed(1);
    const sign = f.val > 0 ? "+" : "";
    const cls  = f.val > 0 ? "pos" : "neg";
    return `<div class="bd-row">
      <span class="bd-label">${f.label}</span>
      <div class="bd-bar-wrap">
        <div class="bd-bar ${cls}" style="width:${pct}%"></div>
        <span class="bd-val ${cls}">${sign}${yen.format(f.val)}円</span>
      </div>
    </div>`;
  });

  rows.push(`<div class="bd-total">
    <span>推定中央値</span>
    <strong>${yen.format(roundTo50(total))}円</strong>
  </div>`);

  out.breakdownList.innerHTML = rows.join("");
}

/* ══════════════════════════════════════════
   Advice checklist
══════════════════════════════════════════ */
function renderAdvice(status, hasCap, emp, area, shift, diff, annDiff) {
  const items = [];

  if (status === "low") {
    items.push("直近3〜6か月の処方箋枚数・対応科目・疑義照会件数・残業の実態を数字でまとめる。");
    items.push("同じ地域・業態の求人を3〜5件調べ、現在の時給との差を比較資料として用意する。");
    if (Math.abs(annDiff) >= 100000) {
      items.push(`年収ベースに換算すると年間 ${yen.format(Math.abs(annDiff))}円の差があります。交渉時にこの金額を明示すると具体性と説得力が増します。`);
    }
  } else if (status === "high") {
    items.push("時給だけでなく、有休取得のしやすさ・残業・通勤・社会保険・契約更新条件も総合的に確認する。");
    items.push("高時給の背景が急募・一人薬剤師・採用難などの事情に偏っていないか確認する。");
  } else {
    items.push("現状は大きなズレは少なめ。業務範囲が増えたタイミングで50〜150円単位の見直しを提案しやすくなります。");
    items.push("勤務可能な曜日・時間帯を広げられる場合は、条件変更とセットで交渉すると通りやすくなります。");
  }

  if (hasCap) {
    items.push("一人薬剤師・在宅・管理薬剤師補助は給与反映を求めやすい実績項目です。担当頻度・件数を具体的な数字で示してください。");
  }

  if (emp === "regular") {
    items.push("正社員の時給換算は残業代を含まない年収 ÷ 年間所定労働時間です。実残業が多い場合、体感時給はさらに低下します。");
  }

  if (emp === "temp") {
    items.push("派遣は交通費の扱い（別途支給/込み）・月額保証の有無で手取り感が大きく変わります。時給額だけで他社と比較しないよう注意してください。");
  }

  if (area === "shortage" || shift === "flexible") {
    items.push("採用難地域・夜間/土日対応は代替人材の希少性が交渉材料になります。「この条件に対応できる薬剤師が少ない」という点を具体的に示せると有利です。");
  }

  out.adviceList.innerHTML = items
    .map(txt => `<li>${txt}</li>`)
    .join("");
}

/* ══════════════════════════════════════════
   Employment mode switch
══════════════════════════════════════════ */
function updateMode(resetPay = false) {
  const emp    = fields.employment.value;
  const isFTE  = emp === "regular";

  fields.payLabel.textContent  = isFTE ? "現在の年収" : "現在の時給";
  fields.payUnit.textContent   = isFTE ? "万円" : "円";
  fields.payHelp.textContent   = isFTE
    ? "残業代を含まない年収を入力。時給は自動換算"
    : "パート・派遣は現在の時給を入力";
  fields.hoursHelp.textContent = isFTE
    ? "正社員は所定労働時間（初期値は週40時間）"
    : "月収・年収目安の計算に使用";

  fields.currentWage.min  = isFTE ? 250  : 1000;
  fields.currentWage.max  = isFTE ? 1200 : 6000;
  fields.currentWage.step = isFTE ? 10   : 50;

  if (isFTE) {
    fields.shift.value       = "fullDay";
    fields.weeklyHours.value = 40;
    if (resetPay) fields.currentWage.value = 500;
  } else if (resetPay) {
    fields.shift.value       = "weekday";
    fields.weeklyHours.value = 24;
    fields.currentWage.value = emp === "temp" ? 2900 : 2200;
  }
}

/* ══════════════════════════════════════════
   Reset
══════════════════════════════════════════ */
function resetForm() {
  fields.currentWage.value  = 2200;
  fields.employment.value   = "part";
  fields.area.value         = "metro";
  fields.workplace.value    = "pharmacy";
  fields.experience.value   = "year5to6";
  fields.shift.value        = "weekday_part";
  fields.weeklyHours.value  = 24;
  fields.solo.checked       = false;
  fields.homecare.checked   = false;
  fields.leadership.checked = false;
  prevEmployment = "part";
  updateMode(false);
  // リセット時は結果を非表示に戻す
  const card = document.getElementById("resultCard");
  card.classList.add("result-card--hidden");
  card.classList.remove("result-card--visible");
}

/* ══════════════════════════════════════════
   Events
══════════════════════════════════════════ */

// 雇用形態変更時はフォームの表示モードだけ切り替え（計算はしない）
form.addEventListener("change", e => {
  if (e.target === fields.employment && fields.employment.value !== prevEmployment) {
    updateMode(true);
    prevEmployment = fields.employment.value;
  }
});

// チェックボタン
document.getElementById("checkBtn").addEventListener("click", () => {
  calculate();
  const card = document.getElementById("resultCard");
  card.classList.remove("result-card--hidden");
  card.classList.remove("result-card--visible");
  // reflow して animation を再発火
  void card.offsetWidth;
  card.classList.add("result-card--visible");
  // スクロール（スマホ対応）
  card.scrollIntoView({ behavior: "smooth", block: "start" });
});

// シェアボタン
document.getElementById("shareBtn").addEventListener("click", () => {
  const url  = "https://kiyo715.github.io/liberty-pharmacist-simulator/";
  const text = "薬剤師の適正給料を無料でチェックできます！";
  if (navigator.share) {
    navigator.share({ title: "リバティ薬剤師 適正給料シミュレーター", text, url });
  } else {
    navigator.clipboard.writeText(url).then(() => {
      const btn = document.getElementById("shareBtn");
      const orig = btn.innerHTML;
      btn.textContent = "URLをコピーしました ✓";
      setTimeout(() => { btn.innerHTML = orig; }, 2000);
    });
  }
});

document.querySelector("#resetBtn").addEventListener("click", resetForm);

/* ── Init ── */
updateMode(false);
