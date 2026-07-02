const TG_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TG_CHAT = process.env.TELEGRAM_CHAT_ID;
const DRY_RUN = process.argv.includes('--dry');

const GOLD_SPREAD = 0.66;
const SILVER_SPREAD = 0.06;

const esc = (s) =>
  String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

const fmt = (n, d = 2) =>
  Number(n).toLocaleString('zh-TW', {
    minimumFractionDigits: d,
    maximumFractionDigits: d,
  });

async function fetchJson(url, opts = {}) {
  const res = await fetch(url, {
    ...opts,
    headers: { 'User-Agent': 'tg-daily-bot/1.0', ...(opts.headers || {}) },
  });
  if (!res.ok) throw new Error(`${url} -> HTTP ${res.status}`);
  return res.json();
}

async function getMetals() {
  const [gold, silver] = await Promise.all([
    fetchJson('https://api.gold-api.com/price/XAU'),
    fetchJson('https://api.gold-api.com/price/XAG'),
  ]);
  const make = (mid, spread) => ({
    mid,
    bid: mid - spread / 2,
    ask: mid + spread / 2,
  });
  return {
    gold: make(gold.price, GOLD_SPREAD),
    silver: make(silver.price, SILVER_SPREAD),
  };
}

async function getCrypto() {
  const data = await fetchJson(
    'https://api.coingecko.com/api/v3/simple/price?ids=bitcoin,ethereum,solana,dogecoin&vs_currencies=usd,twd&include_24hr_change=true'
  );
  const pick = (k) => ({
    usd: data[k].usd,
    twd: data[k].twd,
    chg: data[k].usd_24h_change ?? 0,
  });
  return {
    btc: pick('bitcoin'),
    eth: pick('ethereum'),
    sol: pick('solana'),
    doge: pick('dogecoin'),
  };
}

async function getHeadlines() {
  try {
    const data = await fetchJson(
      'https://api-one.wallstcn.com/apiv1/content/articles/hot?period=all'
    );
    const items = data?.data?.day_items || [];
    if (items.length) {
      return items.slice(0, 8).map((n) => ({ title: n.title, url: n.uri }));
    }
  } catch (e) {
    console.warn('wallstcn hot articles failed, trying lives:', e.message);
  }
  try {
    const data = await fetchJson(
      'https://api-one.wallstcn.com/apiv1/content/lives?channel=global-channel&limit=8'
    );
    const items = data?.data?.items || [];
    return items.slice(0, 8).map((n) => ({
      title: (n.content_text || '').replace(/\s+/g, ' ').slice(0, 60),
      url: n.uri,
    }));
  } catch (e) {
    console.warn('wallstcn lives failed:', e.message);
    return [];
  }
}

function buildMessage({ metals, crypto, headlines }) {
  const today = new Date().toLocaleDateString('zh-TW', {
    month: 'numeric',
    day: 'numeric',
  });
  const arrow = (c) => (c >= 0 ? '🔺' : '🔻');
  const lines = [
    `💰 <b>贵金属行情（现货）</b> ${esc(today)}`,
    `黄金 XAUUSD：$${fmt(metals.gold.mid)} USD/盎司`,
    `买入：$${fmt(metals.gold.bid)} | 卖出：$${fmt(metals.gold.ask)}`,
    `白银 XAGUSD：$${fmt(metals.silver.mid)} USD/盎司`,
    `买入：$${fmt(metals.silver.bid)} | 卖出：$${fmt(metals.silver.ask)}`,
    '',
    '💎 <b>加密货币行情</b>',
    '比特币 BTC',
    `💰 $${fmt(crypto.btc.usd)} USD | NT$${fmt(crypto.btc.twd, 0)}`,
    `${arrow(crypto.btc.chg)} 24h: ${crypto.btc.chg.toFixed(2)}%`,
    '',
    '以太币 ETH',
    `💰 $${fmt(crypto.eth.usd)} USD | NT$${fmt(crypto.eth.twd, 0)}`,
    `${arrow(crypto.eth.chg)} 24h: ${crypto.eth.chg.toFixed(2)}%`,
    '',
    'Solana SOL',
    `💰 $${fmt(crypto.sol.usd)} USD | NT$${fmt(crypto.sol.twd, 0)}`,
    `${arrow(crypto.sol.chg)} 24h: ${crypto.sol.chg.toFixed(2)}%`,
    '',
    '狗狗币 DOGE',
    `💰 $${fmt(crypto.doge.usd, 4)} USD | NT$${fmt(crypto.doge.twd, 2)}`,
    `${arrow(crypto.doge.chg)} 24h: ${crypto.doge.chg.toFixed(2)}%`,
  ];
  if (headlines.length) {
    lines.push('', '📰 <b>今日财经头条（华尔街见闻）</b>');
    for (const h of headlines) {
      lines.push(`• <a href="${esc(h.url)}">${esc(h.title)}</a>`);
    }
  }
  return lines.join('\n');
}

async function sendTelegram(text) {
  const url = `https://api.telegram.org/bot${TG_TOKEN}/sendMessage`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: TG_CHAT,
      text,
      parse_mode: 'HTML',
      disable_web_page_preview: true,
    }),
  });
  const data = await res.json();
  if (!data.ok) throw new Error(`Telegram API: ${JSON.stringify(data)}`);
  return data;
}

(async () => {
  const stamp = new Date().toISOString();
  try {
    if (!DRY_RUN && (!TG_TOKEN || !TG_CHAT)) {
      throw new Error('Missing TELEGRAM_BOT_TOKEN or TELEGRAM_CHAT_ID in .env');
    }
    const [metals, crypto, headlines] = await Promise.all([
      getMetals(),
      getCrypto(),
      getHeadlines(),
    ]);
    const text = buildMessage({ metals, crypto, headlines });
    if (DRY_RUN) {
      console.log('--- DRY RUN: message preview ---');
      console.log(text);
      console.log('--- end preview ---');
      return;
    }
    await sendTelegram(text);
    console.log(`[${stamp}] sent OK`);
  } catch (e) {
    console.error(`[${stamp}] FAILED:`, e.message);
    process.exit(1);
  }
})();
