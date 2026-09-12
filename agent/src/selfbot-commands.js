/**
 * Extended self-command library for the alt-account selfbot.
 *
 * Every entry becomes its own plugin (toggle + rename the trigger word from
 * the Alt Plugins tab). The shared prefix is set by the "commandPrefix"
 * plugin — commands here fire when the message starts with that prefix
 * followed by the plugin's configured command word.
 *
 * Each `run(ctx)` returns:
 *   - a string  → sent to the channel
 *   - an object → passed straight to msg.channel.send(payload)
 *   - null / undefined → nothing sent (already handled inside run)
 */
import crypto from "node:crypto";
import os from "node:os";

/* ---------- helpers ---------- */
const clip = (s, n = 1900) => String(s ?? "").slice(0, n);
const send = (msg, s) => msg.channel.send(clip(s)).catch(() => {});
const joined = (args) => args.join(" ");
const die = (m) => { throw new Error(m); };

const randInt = (a, b) => Math.floor(Math.random() * (b - a + 1)) + a;
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

/* ---------- unicode maps ---------- */
const ABC = "abcdefghijklmnopqrstuvwxyz";
const ABCU = ABC.toUpperCase();
const mapChars = (src, dstL, dstU) => (s) => s.split("").map((c) => {
  const i = ABC.indexOf(c); if (i >= 0) return dstL[i] || c;
  const j = ABCU.indexOf(c); if (j >= 0) return dstU[j] || c;
  return c;
}).join("");
const boldU  = mapChars(0, [..."𝐚𝐛𝐜𝐝𝐞𝐟𝐠𝐡𝐢𝐣𝐤𝐥𝐦𝐧𝐨𝐩𝐪𝐫𝐬𝐭𝐮𝐯𝐰𝐱𝐲𝐳"], [..."𝐀𝐁𝐂𝐃𝐄𝐅𝐆𝐇𝐈𝐉𝐊𝐋𝐌𝐍𝐎𝐏𝐐𝐑𝐒𝐓𝐔𝐕𝐖𝐗𝐘𝐙"]);
const itaU   = mapChars(0, [..."𝑎𝑏𝑐𝑑𝑒𝑓𝑔ℎ𝑖𝑗𝑘𝑙𝑚𝑛𝑜𝑝𝑞𝑟𝑠𝑡𝑢𝑣𝑤𝑥𝑦𝑧"], [..."𝐴𝐵𝐶𝐷𝐸𝐹𝐺𝐻𝐼𝐽𝐾𝐿𝑀𝑁𝑂𝑃𝑄𝑅𝑆𝑇𝑈𝑉𝑊𝑋𝑌𝑍"]);
const boldIta= mapChars(0, [..."𝒂𝒃𝒄𝒅𝒆𝒇𝒈𝒉𝒊𝒋𝒌𝒍𝒎𝒏𝒐𝒑𝒒𝒓𝒔𝒕𝒖𝒗𝒘𝒙𝒚𝒛"], [..."𝑨𝑩𝑪𝑫𝑬𝑭𝑮𝑯𝑰𝑱𝑲𝑳𝑴𝑵𝑶𝑷𝑸𝑹𝑺𝑻𝑼𝑽𝑾𝑿𝒀𝒁"]);
const monoU  = mapChars(0, [..."𝚊𝚋𝚌𝚍𝚎𝚏𝚐𝚑𝚒𝚓𝚔𝚕𝚖𝚗𝚘𝚙𝚚𝚛𝚜𝚝𝚞𝚟𝚠𝚡𝚢𝚣"], [..."𝙰𝙱𝙲𝙳𝙴𝙵𝙶𝙷𝙸𝙹𝙺𝙻𝙼𝙽𝙾𝙿𝚀𝚁𝚂𝚃𝚄𝚅𝚆𝚇𝚈𝚉"]);
const cursU  = mapChars(0, [..."𝒶𝒷𝒸𝒹ℯ𝒻ℊ𝒽𝒾𝒿𝓀𝓁𝓂𝓃ℴ𝓅𝓆𝓇𝓈𝓉𝓊𝓋𝓌𝓍𝓎𝓏"], [..."𝒜ℬ𝒞𝒟ℰℱ𝒢ℋℐ𝒥𝒦ℒℳ𝒩𝒪𝒫𝒬ℛ𝒮𝒯𝒰𝒱𝒲𝒳𝒴𝒵"]);
const frakU  = mapChars(0, [..."𝔞𝔟𝔠𝔡𝔢𝔣𝔤𝔥𝔦𝔧𝔨𝔩𝔪𝔫𝔬𝔭𝔮𝔯𝔰𝔱𝔲𝔳𝔴𝔵𝔶𝔷"], [..."𝔄𝔅ℭ𝔇𝔈𝔉𝔊ℌℑ𝔍𝔎𝔏𝔐𝔑𝔒𝔓𝔔ℜ𝔖𝔗𝔘𝔙𝔚𝔛𝔜ℨ"]);
const dsU    = mapChars(0, [..."𝕒𝕓𝕔𝕕𝕖𝕗𝕘𝕙𝕚𝕛𝕜𝕝𝕞𝕟𝕠𝕡𝕢𝕣𝕤𝕥𝕦𝕧𝕨𝕩𝕪𝕫"], [..."𝔸𝔹ℂ𝔻𝔼𝔽𝔾ℍ𝕀𝕁𝕂𝕃𝕄ℕ𝕆ℙℚℝ𝕊𝕋𝕌𝕍𝕎𝕏𝕐ℤ"]);
const bubbleU= mapChars(0, [..."ⓐⓑⓒⓓⓔⓕⓖⓗⓘⓙⓚⓛⓜⓝⓞⓟⓠⓡⓢⓣⓤⓥⓦⓧⓨⓩ"], [..."ⒶⒷⒸⒹⒺⒻⒼⒽⒾⒿⓀⓁⓂⓃⓄⓅⓆⓇⓈⓉⓊⓋⓌⓍⓎⓏ"]);
const sqU    = mapChars(0, [..."🄰🄱🄲🄳🄴🄵🄶🄷🄸🄹🄺🄻🄼🄽🄾🄿🅀🅁🅂🅃🅄🅅🅆🅇🅈🅉"], [..."🄰🄱🄲🄳🄴🄵🄶🄷🄸🄹🄺🄻🄼🄽🄾🄿🅀🅁🅂🅃🅄🅅🅆🅇🅈🅉"]);
const negSqU = mapChars(0, [..."🅐🅑🅒🅓🅔🅕🅖🅗🅘🅙🅚🅛🅜🅝🅞🅟🅠🅡🅢🅣🅤🅥🅦🅧🅨🅩"], [..."🅐🅑🅒🅓🅔🅕🅖🅗🅘🅙🅚🅛🅜🅝🅞🅟🅠🅡🅢🅣🅤🅥🅦🅧🅨🅩"]);
const smallCapsMap = { a:"ᴀ",b:"ʙ",c:"ᴄ",d:"ᴅ",e:"ᴇ",f:"ꜰ",g:"ɢ",h:"ʜ",i:"ɪ",j:"ᴊ",k:"ᴋ",l:"ʟ",m:"ᴍ",n:"ɴ",o:"ᴏ",p:"ᴘ",q:"Q",r:"ʀ",s:"s",t:"ᴛ",u:"ᴜ",v:"ᴠ",w:"ᴡ",x:"x",y:"ʏ",z:"ᴢ" };
const smallCaps = (s) => s.toLowerCase().split("").map((c) => smallCapsMap[c] || c).join("");
const flipMap = { a:"ɐ",b:"q",c:"ɔ",d:"p",e:"ǝ",f:"ɟ",g:"ƃ",h:"ɥ",i:"ᴉ",j:"ɾ",k:"ʞ",l:"l",m:"ɯ",n:"u",o:"o",p:"d",q:"b",r:"ɹ",s:"s",t:"ʇ",u:"n",v:"ʌ",w:"ʍ",x:"x",y:"ʎ",z:"z","?":"¿",".":"˙",",":"'","!":"¡" };
const flip = (s) => s.toLowerCase().split("").reverse().map((c) => flipMap[c] || c).join("");
const fullwidth = (s) => s.split("").map((c) => { const n = c.charCodeAt(0); return n >= 33 && n <= 126 ? String.fromCharCode(n + 0xFEE0) : (c === " " ? "\u3000" : c); }).join("");
const zalgo = (s) => { const marks = ["\u0300","\u0301","\u0302","\u0303","\u0304","\u0305","\u0306","\u0307","\u0308","\u030A","\u030B","\u030C","\u030F","\u0310","\u0311","\u0312","\u0313","\u0314","\u0315","\u0316","\u0317","\u0318","\u0319","\u031A","\u031B","\u031C","\u031D","\u031E","\u031F","\u0320","\u0321","\u0322","\u0323","\u0324","\u0325","\u0326","\u0327","\u0328","\u0329","\u032A"]; return s.split("").map((c) => c + Array.from({length:randInt(2,6)},() => pick(marks)).join("")).join(""); };
const mock = (s) => s.split("").map((c, i) => i % 2 ? c.toUpperCase() : c.toLowerCase()).join("");
const leetMap = { a:"4",b:"8",e:"3",g:"9",i:"1",l:"1",o:"0",s:"5",t:"7",z:"2" };
const leet = (s) => s.toLowerCase().split("").map((c) => leetMap[c] || c).join("");
const rot13 = (s) => s.replace(/[a-zA-Z]/g, (c) => { const b = c <= "Z" ? 65 : 97; return String.fromCharCode(((c.charCodeAt(0) - b + 13) % 26) + b); });
const rot47 = (s) => s.replace(/[!-~]/g, (c) => String.fromCharCode(33 + (c.charCodeAt(0) - 33 + 47) % 94));
const atbash = (s) => s.replace(/[a-zA-Z]/g, (c) => { const b = c <= "Z" ? 65 : 97; return String.fromCharCode(b + 25 - (c.charCodeAt(0) - b)); });

const MORSE = { A:".-",B:"-...",C:"-.-.",D:"-..",E:".",F:"..-.",G:"--.",H:"....",I:"..",J:".---",K:"-.-",L:".-..",M:"--",N:"-.",O:"---",P:".--.",Q:"--.-",R:".-.",S:"...",T:"-",U:"..-",V:"...-",W:".--",X:"-..-",Y:"-.--",Z:"--..","0":"-----","1":".----","2":"..---","3":"...--","4":"....-","5":".....","6":"-....","7":"--...","8":"---..","9":"----." };
const REV_MORSE = Object.fromEntries(Object.entries(MORSE).map(([k, v]) => [v, k]));
const morseEnc = (s) => s.toUpperCase().split("").map((c) => c === " " ? "/" : (MORSE[c] || "")).filter(Boolean).join(" ");
const morseDec = (s) => s.split(" / ").map((w) => w.split(" ").map((t) => REV_MORSE[t] || "").join("")).join(" ");

const toBinary = (s) => Buffer.from(s, "utf8").reduce((a, b) => a + b.toString(2).padStart(8, "0") + " ", "").trim();
const fromBinary = (s) => { const bits = s.replace(/\s+/g, ""); const out = []; for (let i = 0; i < bits.length; i += 8) out.push(parseInt(bits.slice(i, i + 8), 2)); return Buffer.from(out).toString("utf8"); };

/* ---------- safe math eval ---------- */
const safeMath = (expr) => {
  if (!/^[\d+\-*/().,%\s^]+$/.test(expr)) die("only numbers + - * / % ^ ( ) allowed");
  const js = expr.replace(/\^/g, "**");
  // eslint-disable-next-line no-new-func
  const val = Function(`"use strict"; return (${js});`)();
  if (!Number.isFinite(val)) die("bad number");
  return String(val);
};

/* ---------- misc data ---------- */
const EIGHT_BALL = ["yes.","no.","obviously.","not a chance.","ask again later.","without a doubt.","very doubtful.","most likely.","don't count on it.","signs point to yes.","the answer is no.","idk figure it out."];
const COMPLIMENTS = ["you're doing great.","that outfit slaps.","you're wildly underrated.","genuinely one of the good ones.","the whole vibe is elite."];
const INSULTS = ["you eat cereal with a fork.","your github has a readme in comic sans.","you close vim with :q!... and still can't.","you use light mode on a Thursday."];
const JOKES = ["why do programmers hate nature? too many bugs.","there are 10 kinds of people: binary and normal.","i told my computer i needed a break — it froze.","a SQL query walks into a bar, walks up to two tables and asks, 'can i join you?'"];
const QUOTES = ["\"be so good they can't ignore you.\" — steve martin","\"the best time to plant a tree was 20 years ago. the second best is now.\"","\"don't be afraid to give up the good to go for the great.\" — rockefeller"];
const FACTS = ["octopuses have three hearts.","honey never spoils.","bananas are berries. strawberries aren't.","a group of flamingos is called a flamboyance."];
const FORTUNES = ["a nice surprise is coming.","you'll fix that bug on the first try. lol jk.","today: touch grass.","expect a random ping in ~4 hours."];
const WORDS = ["cascade","void","synth","glitch","matrix","vector","nova","echo","aether","cipher","lattice","quantum","zenith","photon","kernel"];
const NAMES = ["kai","milo","ren","aya","yuki","juno","zed","nyx","kira","axel"];

/* ---------- plugin factory ---------- */
function makeCmd(P, { id, name, description, defaultCommand, extra, run }) {
  P({
    id, name, description,
    defaultConfig: { command: defaultCommand, ...(extra || {}) },
    hooks: {
      async onCommand(ctx, msg, { name: n, args, raw }) {
        if (n !== ctx.cfg.command) return false;
        try {
          const out = await run({ ctx, msg, args, raw, cfg: ctx.cfg, client: ctx.client });
          if (out == null) return true;
          if (typeof out === "string") await send(msg, out);
          else await msg.channel.send(out).catch(() => {});
        } catch (err) {
          await send(msg, `error: ${err.message}`);
        }
        return true;
      },
    },
  });
}

/* ---------- registration ---------- */
export function registerSelfCommands(P) {
  const cmd = (spec) => makeCmd(P, spec);

  /* ---------- text transforms (66) ---------- */
  const textOps = [
    ["reverse",       "Reverse text",                (s) => s.split("").reverse().join("")],
    ["upper",         "UPPERCASE",                    (s) => s.toUpperCase()],
    ["lower",         "lowercase",                    (s) => s.toLowerCase()],
    ["title",         "Title Case",                   (s) => s.replace(/\b\w/g, (c) => c.toUpperCase())],
    ["capitalize",    "Capitalize first letter",      (s) => s.charAt(0).toUpperCase() + s.slice(1)],
    ["swapcase",      "Swap case of every letter",    (s) => s.split("").map((c) => c === c.toUpperCase() ? c.toLowerCase() : c.toUpperCase()).join("")],
    ["mock",          "SpOnGeBoB mocking case",       mock],
    ["spongebob",     "Alias of mock",                mock],
    ["sarcasm",       "Alias of mock",                mock],
    ["leet",          "1337 speak",                   leet],
    ["clap",          "Word 👏 by 👏 word",           (s) => s.split(/\s+/).filter(Boolean).join(" 👏 ")],
    ["spaced",        "S p a c e d   o u t",          (s) => s.split("").join(" ")],
    ["rot13",         "ROT13 cipher",                 rot13],
    ["rot47",         "ROT47 cipher",                 rot47],
    ["atbash",        "Atbash cipher",                atbash],
    ["revwords",      "Reverse word order",           (s) => s.split(/\s+/).reverse().join(" ")],
    ["shuffle",       "Shuffle characters",           (s) => s.split("").sort(() => Math.random() - 0.5).join("")],
    ["binary",        "Encode text as binary",        toBinary],
    ["unbinary",      "Decode binary to text",        fromBinary],
    ["hex",           "Encode text as hex",           (s) => Buffer.from(s, "utf8").toString("hex")],
    ["unhex",         "Decode hex to text",           (s) => Buffer.from(s.replace(/\s+/g, ""), "hex").toString("utf8")],
    ["b64",           "Encode text as base64",        (s) => Buffer.from(s, "utf8").toString("base64")],
    ["unb64",         "Decode base64",                (s) => Buffer.from(s, "base64").toString("utf8")],
    ["urlenc",        "URL-encode",                   (s) => encodeURIComponent(s)],
    ["urldec",        "URL-decode",                   (s) => decodeURIComponent(s)],
    ["morse",         "Encode Morse code",            morseEnc],
    ["unmorse",       "Decode Morse code",            morseDec],
    ["flip",          "Upside-down text",             flip],
    ["fullwidth",     "Ｆｕｌｌｗｉｄｔｈ text",       fullwidth],
    ["vaporwave",     "Aesthetic  ｖａｐｏｒ",        (s) => fullwidth(s).split("").join(" ")],
    ["smallcaps",     "ꜱᴍᴀʟʟ ᴄᴀᴘꜱ",                 smallCaps],
    ["boldu",         "𝐁𝐨𝐥𝐝 unicode",             boldU],
    ["itau",          "𝐼𝑡𝑎𝑙𝑖𝑐 unicode",         itaU],
    ["bolditau",      "𝑩𝒐𝒍𝒅 𝒊𝒕𝒂𝒍𝒊𝒄 unicode",   boldIta],
    ["monou",         "𝙼𝚘𝚗𝚘 unicode",             monoU],
    ["cursive",       "𝒞𝓊𝓇𝓈𝒾𝓋𝑒 script",         cursU],
    ["fraktur",       "𝔉𝔯𝔞𝔨𝔱𝔲𝔯",                 frakU],
    ["doublestruck",  "𝔻𝕠𝕦𝕓𝕝𝕖 𝕤𝕥𝕣𝕦𝕔𝕜",         dsU],
    ["bubble",        "Ⓑⓤⓑⓑⓛⓔ text",              bubbleU],
    ["squared",       "🅂🅀🅄🄰🅁🄴🄳",                   sqU],
    ["negsquared",    "Negative squared",             negSqU],
    ["zalgo",         "H̸e̷ ̶c̸o̷m̶e̸s̷",              zalgo],
    ["revlines",      "Reverse line order",           (s) => s.split("\n").reverse().join("\n")],
    ["sortlines",     "Sort lines alphabetically",    (s) => s.split("\n").sort().join("\n")],
    ["dedupe",        "Remove duplicate lines",       (s) => [...new Set(s.split("\n"))].join("\n")],
    ["shuflines",     "Shuffle line order",           (s) => s.split("\n").sort(() => Math.random() - 0.5).join("\n")],
    ["wc",            "Count words",                  (s) => `${s.trim().split(/\s+/).filter(Boolean).length} words`],
    ["cc",            "Count characters",             (s) => `${[...s].length} characters`],
    ["lc",            "Count lines",                  (s) => `${s.split("\n").length} lines`],
    ["slug",          "URL slug (kebab-case)",        (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")],
    ["snake",         "snake_case",                   (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "")],
    ["camel",         "camelCase",                    (s) => { const p = s.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean); return p[0] + p.slice(1).map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(""); }],
    ["pascal",        "PascalCase",                   (s) => s.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean).map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join("")],
    ["kebab",         "kebab-case",                   (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")],
    ["nospace",       "Strip spaces",                 (s) => s.replace(/\s+/g, "")],
    ["nopunct",       "Strip punctuation",            (s) => s.replace(/[^\p{L}\p{N}\s]/gu, "")],
    ["novowels",      "Strip vowels",                 (s) => s.replace(/[aeiouAEIOU]/g, "")],
    ["length",        "Text length",                  (s) => `length: ${[...s].length}`],
    ["repeat",        "Repeat text N times: `<n> <text>`", (s) => { const [n, ...rest] = s.split(/\s+/); const t = rest.join(" "); return t.repeat(Math.min(Math.max(Number(n) || 1, 1), 50)); }],
    ["rot",           "Rotate letters by N: `<n> <text>`", (s) => { const [n, ...rest] = s.split(/\s+/); const k = ((Number(n) || 0) % 26 + 26) % 26; return rest.join(" ").replace(/[a-zA-Z]/g, (c) => { const b = c <= "Z" ? 65 : 97; return String.fromCharCode(((c.charCodeAt(0) - b + k) % 26) + b); }); }],
    ["replace",       "Replace: `<from>|<to>|<text>`", (s) => { const [f, t, ...rest] = s.split("|"); return rest.join("|").replace(new RegExp(f, "g"), t); }],
    ["stripemoji",    "Strip emoji",                  (s) => s.replace(/[\p{Extended_Pictographic}]/gu, "")],
    ["striplinks",    "Strip URLs",                   (s) => s.replace(/https?:\/\/\S+/g, "")],
    ["expand",        "Expand with spaces per char",  (s) => s.split("").join("  ")],
    ["shrink",        "Collapse whitespace",          (s) => s.replace(/\s+/g, " ").trim()],
    ["mirror",        "Mirror around middle",         (s) => s + s.split("").reverse().join("")],
    ["ascii",         "Codepoints for each char",     (s) => [...s].map((c) => c.charCodeAt(0)).join(" ")],
  ];
  for (const [name, desc, fn] of textOps) {
    cmd({
      id: `txt_${name}`, name: `text · ${name}`, description: desc, defaultCommand: name,
      run: ({ args }) => args.length ? fn(joined(args)) : `usage: ${name} <text>`,
    });
  }

  /* ---------- random / fun (40) ---------- */
  cmd({ id: "r_8ball", name: "8-ball", description: "Magic 8-ball.", defaultCommand: "8ball",
    run: ({ args }) => args.length ? `🎱 ${pick(EIGHT_BALL)}` : "ask a question first." });
  cmd({ id: "r_coin", name: "Coin flip", description: "Heads or tails.", defaultCommand: "coin",
    run: () => Math.random() < 0.5 ? "🪙 heads" : "🪙 tails" });
  cmd({ id: "r_dice", name: "Dice", description: "Roll a d6.", defaultCommand: "dice",
    run: () => `🎲 ${randInt(1, 6)}` });
  cmd({ id: "r_roll", name: "Dice roll NdM", description: "e.g. roll 2d20", defaultCommand: "roll",
    run: ({ args }) => { const m = /^(\d+)d(\d+)$/i.exec(args[0] || "1d6"); if (!m) return "format: NdM"; const [_, n, s] = m; const rolls = Array.from({length: Math.min(+n, 100)}, () => randInt(1, +s)); return `🎲 ${rolls.join(", ")} = ${rolls.reduce((a, b) => a + b, 0)}`; } });
  cmd({ id: "r_choose", name: "Choose", description: "choose a | b | c", defaultCommand: "choose",
    run: ({ args }) => { const opts = joined(args).split("|").map((s) => s.trim()).filter(Boolean); return opts.length ? `→ ${pick(opts)}` : "give me options."; } });
  cmd({ id: "r_num", name: "Random number", description: "random [min] [max]", defaultCommand: "random",
    run: ({ args }) => { const a = Number(args[0] ?? 0); const b = Number(args[1] ?? 100); return String(randInt(Math.min(a, b), Math.max(a, b))); } });
  cmd({ id: "r_hex", name: "Random hex color", description: "Random hex color.", defaultCommand: "randhex",
    run: () => "#" + Math.floor(Math.random() * 0xffffff).toString(16).padStart(6, "0") });
  cmd({ id: "r_uuid", name: "Random UUID", description: "UUID v4.", defaultCommand: "uuid",
    run: () => crypto.randomUUID() });
  cmd({ id: "r_pw", name: "Random password", description: "random password [len=16]", defaultCommand: "password",
    run: ({ args }) => { const n = Math.min(Math.max(+args[0] || 16, 4), 128); const chars = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789!@#$%^&*"; return Array.from({length: n}, () => pick(chars.split(""))).join(""); } });
  cmd({ id: "r_word", name: "Random word", description: "Random word.", defaultCommand: "randword", run: () => pick(WORDS) });
  cmd({ id: "r_name", name: "Random name", description: "Random name.", defaultCommand: "randname", run: () => pick(NAMES) });
  cmd({ id: "r_yesno", name: "Yes or no", description: "Yes or no.", defaultCommand: "yesno", run: () => Math.random() < 0.5 ? "yes." : "no." });
  cmd({ id: "r_fortune", name: "Fortune", description: "A fortune.", defaultCommand: "fortune", run: () => pick(FORTUNES) });
  cmd({ id: "r_comp", name: "Compliment", description: "A compliment.", defaultCommand: "compliment", run: () => pick(COMPLIMENTS) });
  cmd({ id: "r_insult", name: "Insult", description: "An insult.", defaultCommand: "insult", run: () => pick(INSULTS) });
  cmd({ id: "r_joke", name: "Joke", description: "A joke.", defaultCommand: "joke", run: () => pick(JOKES) });
  cmd({ id: "r_quote", name: "Quote", description: "A quote.", defaultCommand: "randquote", run: () => pick(QUOTES) });
  cmd({ id: "r_fact", name: "Fact", description: "A random fact.", defaultCommand: "fact", run: () => pick(FACTS) });
  cmd({ id: "r_rate", name: "Rate", description: "Rate anything 1–10.", defaultCommand: "rate",
    run: ({ args }) => args.length ? `${joined(args)} → ${randInt(1, 10)}/10` : "rate what?" });
  cmd({ id: "r_ship", name: "Ship", description: "ship a b → %", defaultCommand: "ship",
    run: ({ args }) => args.length >= 2 ? `${args[0]} 💘 ${args[1]} = ${randInt(0, 100)}%` : "ship <a> <b>" });
  cmd({ id: "r_love", name: "Love calc", description: "love a b → %", defaultCommand: "love",
    run: ({ args }) => args.length >= 2 ? `❤️ ${args[0]} + ${args[1]} = ${randInt(0, 100)}%` : "love <a> <b>" });
  cmd({ id: "r_iq", name: "IQ score", description: "iq <name>", defaultCommand: "iq",
    run: ({ args }) => `${joined(args) || "you"}: ${randInt(40, 180)} IQ` });
  cmd({ id: "r_hot", name: "Hot %", description: "hot <name>", defaultCommand: "hot",
    run: ({ args }) => `🔥 ${joined(args) || "you"}: ${randInt(0, 100)}% hot` });
  cmd({ id: "r_simp", name: "Simp %", description: "simp <name>", defaultCommand: "simp",
    run: ({ args }) => `${joined(args) || "you"}: ${randInt(0, 100)}% simp` });
  cmd({ id: "r_cool", name: "Cool %", description: "cool <name>", defaultCommand: "cool",
    run: ({ args }) => `😎 ${joined(args) || "you"}: ${randInt(0, 100)}% cool` });
  cmd({ id: "r_smart", name: "Smart %", description: "smart <name>", defaultCommand: "smart",
    run: ({ args }) => `🧠 ${joined(args) || "you"}: ${randInt(0, 100)}% smart` });
  const actions = [
    ["slap", "slaps", "👋"], ["hug", "hugs", "🤗"], ["kiss", "kisses", "😘"],
    ["punch", "punches", "👊"], ["bonk", "bonks", "🔨"], ["pat", "pats", "✋"],
    ["highfive", "high-fives", "🙌"], ["throw", "throws", "🥎"], ["poke", "pokes", "👉"],
    ["boop", "boops", "👆"], ["yeet", "yeets", "🚀"], ["stare", "stares at", "👀"],
    ["salute", "salutes", "🫡"], ["cheers", "cheers with", "🥂"],
  ];
  for (const [a, verb, emoji] of actions) {
    cmd({ id: `act_${a}`, name: `action · ${a}`, description: `${a} <target>`, defaultCommand: a,
      run: ({ args, msg }) => `${emoji} ${msg.author.username} ${verb} ${joined(args) || "the void"}` });
  }

  /* ---------- math / numbers (25) ---------- */
  cmd({ id: "m_calc", name: "Calc", description: "calc <expression>", defaultCommand: "calc",
    run: ({ args }) => safeMath(joined(args)) });
  cmd({ id: "m_hex2dec", name: "hex→dec", description: "hex2dec <hex>", defaultCommand: "hex2dec",
    run: ({ args }) => String(parseInt(args[0], 16)) });
  cmd({ id: "m_dec2hex", name: "dec→hex", description: "dec2hex <n>", defaultCommand: "dec2hex",
    run: ({ args }) => Number(args[0]).toString(16) });
  cmd({ id: "m_dec2bin", name: "dec→bin", description: "dec2bin <n>", defaultCommand: "dec2bin",
    run: ({ args }) => Number(args[0]).toString(2) });
  cmd({ id: "m_bin2dec", name: "bin→dec", description: "bin2dec <bits>", defaultCommand: "bin2dec",
    run: ({ args }) => String(parseInt(args[0], 2)) });
  cmd({ id: "m_dec2oct", name: "dec→oct", description: "dec2oct <n>", defaultCommand: "dec2oct",
    run: ({ args }) => Number(args[0]).toString(8) });
  cmd({ id: "m_oct2dec", name: "oct→dec", description: "oct2dec <n>", defaultCommand: "oct2dec",
    run: ({ args }) => String(parseInt(args[0], 8)) });
  cmd({ id: "m_sqrt", name: "sqrt", description: "sqrt <n>", defaultCommand: "sqrt",
    run: ({ args }) => String(Math.sqrt(Number(args[0]))) });
  cmd({ id: "m_cbrt", name: "cbrt", description: "cbrt <n>", defaultCommand: "cbrt",
    run: ({ args }) => String(Math.cbrt(Number(args[0]))) });
  cmd({ id: "m_pow", name: "pow", description: "pow <a> <b>", defaultCommand: "pow",
    run: ({ args }) => String(Math.pow(Number(args[0]), Number(args[1]))) });
  cmd({ id: "m_fact", name: "factorial", description: "factorial <n>", defaultCommand: "factorial",
    run: ({ args }) => { const n = Math.min(Number(args[0]) || 0, 170); let r = 1; for (let i = 2; i <= n; i++) r *= i; return String(r); } });
  cmd({ id: "m_gcd", name: "gcd", description: "gcd <a> <b>", defaultCommand: "gcd",
    run: ({ args }) => { const g = (a, b) => b ? g(b, a % b) : a; return String(g(Math.abs(+args[0]), Math.abs(+args[1]))); } });
  cmd({ id: "m_lcm", name: "lcm", description: "lcm <a> <b>", defaultCommand: "lcm",
    run: ({ args }) => { const g = (a, b) => b ? g(b, a % b) : a; const a = Math.abs(+args[0]), b = Math.abs(+args[1]); return String(a * b / g(a, b)); } });
  cmd({ id: "m_prime", name: "isprime", description: "isprime <n>", defaultCommand: "isprime",
    run: ({ args }) => { const n = Number(args[0]); if (n < 2) return "no"; for (let i = 2; i * i <= n; i++) if (n % i === 0) return "no"; return "yes"; } });
  cmd({ id: "m_nprime", name: "next prime", description: "nextprime <n>", defaultCommand: "nextprime",
    run: ({ args }) => { let n = Number(args[0]) + 1; const isP = (x) => { if (x < 2) return false; for (let i = 2; i * i <= x; i++) if (x % i === 0) return false; return true; }; while (!isP(n)) n++; return String(n); } });
  cmd({ id: "m_fib", name: "fibonacci", description: "fibonacci <n>", defaultCommand: "fibonacci",
    run: ({ args }) => { const n = Math.min(Number(args[0]) || 0, 80); let a = 0n, b = 1n; for (let i = 0; i < n; i++) [a, b] = [b, a + b]; return a.toString(); } });
  cmd({ id: "m_abs", name: "abs", description: "abs <n>", defaultCommand: "abs", run: ({ args }) => String(Math.abs(+args[0])) });
  cmd({ id: "m_round", name: "round", description: "round <n>", defaultCommand: "round", run: ({ args }) => String(Math.round(+args[0])) });
  cmd({ id: "m_floor", name: "floor", description: "floor <n>", defaultCommand: "floor", run: ({ args }) => String(Math.floor(+args[0])) });
  cmd({ id: "m_ceil", name: "ceil", description: "ceil <n>", defaultCommand: "ceil", run: ({ args }) => String(Math.ceil(+args[0])) });
  cmd({ id: "m_sum", name: "sum", description: "sum <a b c ...>", defaultCommand: "sum",
    run: ({ args }) => String(args.map(Number).reduce((a, b) => a + b, 0)) });
  cmd({ id: "m_avg", name: "avg", description: "avg <a b c ...>", defaultCommand: "avg",
    run: ({ args }) => { const ns = args.map(Number); return String(ns.reduce((a, b) => a + b, 0) / ns.length); } });
  cmd({ id: "m_min", name: "min", description: "min <a b c ...>", defaultCommand: "min", run: ({ args }) => String(Math.min(...args.map(Number))) });
  cmd({ id: "m_max", name: "max", description: "max <a b c ...>", defaultCommand: "max", run: ({ args }) => String(Math.max(...args.map(Number))) });
  cmd({ id: "m_median", name: "median", description: "median <a b c ...>", defaultCommand: "median",
    run: ({ args }) => { const ns = args.map(Number).sort((a, b) => a - b); const m = Math.floor(ns.length / 2); return String(ns.length % 2 ? ns[m] : (ns[m - 1] + ns[m]) / 2); } });

  /* ---------- crypto / encoding (8) ---------- */
  for (const algo of ["md5", "sha1", "sha256", "sha512"]) {
    cmd({ id: `h_${algo}`, name: `hash · ${algo}`, description: `${algo} <text>`, defaultCommand: algo,
      run: ({ args }) => crypto.createHash(algo).update(joined(args)).digest("hex") });
  }
  cmd({ id: "h_hmac", name: "hmac-sha256", description: "hmac <secret> <text>", defaultCommand: "hmac",
    run: ({ args }) => { const [secret, ...rest] = args; return crypto.createHmac("sha256", secret || "").update(rest.join(" ")).digest("hex"); } });
  cmd({ id: "h_bytes", name: "random bytes", description: "randbytes <n=16>", defaultCommand: "randbytes",
    run: ({ args }) => crypto.randomBytes(Math.min(Math.max(+args[0] || 16, 1), 128)).toString("hex") });
  cmd({ id: "h_jwtdec", name: "JWT decode", description: "jwt <token>", defaultCommand: "jwt",
    run: ({ args }) => { const [h, p] = (args[0] || "").split("."); if (!p) die("bad token"); const dec = (b) => Buffer.from(b.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8"); return "```json\n" + JSON.stringify({ header: JSON.parse(dec(h)), payload: JSON.parse(dec(p)) }, null, 2).slice(0, 1800) + "\n```"; } });
  cmd({ id: "h_json", name: "JSON pretty", description: "prettyjson <json>", defaultCommand: "prettyjson",
    run: ({ args }) => "```json\n" + JSON.stringify(JSON.parse(joined(args)), null, 2).slice(0, 1800) + "\n```" });

  /* ---------- info / discord (30) ---------- */
  cmd({ id: "i_ping", name: "Ping", description: "WebSocket latency.", defaultCommand: "ping",
    run: ({ client }) => `🏓 ${Math.round(client.ws?.ping || 0)}ms` });
  cmd({ id: "i_uptime", name: "Uptime", description: "Agent process uptime.", defaultCommand: "uptime",
    run: () => { const s = Math.floor(process.uptime()); return `up ${Math.floor(s / 3600)}h ${Math.floor(s / 60) % 60}m ${s % 60}s`; } });
  cmd({ id: "i_sys", name: "Sysinfo", description: "Host summary.", defaultCommand: "sys",
    run: () => `${os.platform()} ${os.release()} · ${os.cpus()[0]?.model || "cpu"} · ${(os.totalmem() / 1e9).toFixed(1)} GB` });
  cmd({ id: "i_avatar", name: "Avatar URL", description: "avatar [id]", defaultCommand: "avatar",
    run: async ({ args, msg, client }) => { const id = (args[0] || msg.author.id).replace(/[<@!>]/g, ""); const u = await client.users.fetch(id).catch(() => null); return u?.displayAvatarURL?.({ size: 1024 }) || "not found"; } });
  cmd({ id: "i_banner", name: "Banner URL", description: "banner [id]", defaultCommand: "banner",
    run: async ({ args, msg, client }) => { const id = (args[0] || msg.author.id).replace(/[<@!>]/g, ""); const u = await client.users.fetch(id, { force: true }).catch(() => null); return u?.bannerURL?.({ size: 1024 }) || "no banner"; } });
  cmd({ id: "i_gicon", name: "Guild icon", description: "Server icon URL.", defaultCommand: "gicon",
    run: ({ msg }) => msg.guild?.iconURL?.({ size: 1024 }) || "no icon / not in a server" });
  cmd({ id: "i_gbanner", name: "Guild banner", description: "Server banner URL.", defaultCommand: "gbanner",
    run: ({ msg }) => msg.guild?.bannerURL?.({ size: 1024 }) || "no banner" });
  cmd({ id: "i_myid", name: "My ID", description: "Your user ID.", defaultCommand: "myid",
    run: ({ msg }) => `\`${msg.author.id}\`` });
  cmd({ id: "i_myname", name: "My name", description: "Your username.", defaultCommand: "myname",
    run: ({ msg }) => msg.author.username });
  cmd({ id: "i_mytag", name: "My tag", description: "Your discord tag.", defaultCommand: "mytag",
    run: ({ msg }) => msg.author.tag || msg.author.username });
  cmd({ id: "i_srvid", name: "Server ID", description: "Current server ID.", defaultCommand: "srvid",
    run: ({ msg }) => `\`${msg.guild?.id || "dm"}\`` });
  cmd({ id: "i_chid", name: "Channel ID", description: "Current channel ID.", defaultCommand: "chid",
    run: ({ msg }) => `\`${msg.channel.id}\`` });
  cmd({ id: "i_members", name: "Member count", description: "Server member count.", defaultCommand: "members",
    run: ({ msg }) => `${msg.guild?.memberCount ?? 0} members` });
  cmd({ id: "i_roles", name: "Role count", description: "Server role count.", defaultCommand: "roles",
    run: ({ msg }) => `${msg.guild?.roles.cache.size ?? 0} roles` });
  cmd({ id: "i_channels", name: "Channel count", description: "Server channel count.", defaultCommand: "channels",
    run: ({ msg }) => `${msg.guild?.channels.cache.size ?? 0} channels` });
  cmd({ id: "i_boosts", name: "Boost count", description: "Server boost count.", defaultCommand: "boosts",
    run: ({ msg }) => `${msg.guild?.premiumSubscriptionCount ?? 0} boosts (tier ${msg.guild?.premiumTier ?? 0})` });
  cmd({ id: "i_emojis", name: "Emoji count", description: "Server emoji count.", defaultCommand: "emojis",
    run: ({ msg }) => `${msg.guild?.emojis.cache.size ?? 0} emojis` });
  cmd({ id: "i_snowflake", name: "Snowflake time", description: "snowflake <id>", defaultCommand: "snowflake",
    run: ({ args }) => { const id = BigInt(args[0]); const ts = Number((id >> 22n) + 1420070400000n); return `<t:${Math.floor(ts / 1000)}:F>`; } });
  cmd({ id: "i_now", name: "Now (unix)", description: "Unix seconds.", defaultCommand: "now",
    run: () => String(Math.floor(Date.now() / 1000)) });
  cmd({ id: "i_iso", name: "Now (ISO)", description: "ISO timestamp.", defaultCommand: "iso",
    run: () => new Date().toISOString() });
  cmd({ id: "i_tstamp", name: "Discord timestamp", description: "tstamp <unix> [style]", defaultCommand: "tstamp",
    run: ({ args }) => `<t:${args[0] || Math.floor(Date.now() / 1000)}:${args[1] || "F"}>` });
  cmd({ id: "i_srvcreated", name: "Server created", description: "Server creation date.", defaultCommand: "srvcreated",
    run: ({ msg }) => msg.guild ? `<t:${Math.floor(msg.guild.createdTimestamp / 1000)}:F>` : "not in a server" });
  cmd({ id: "i_acctcreated", name: "Account created", description: "acctcreated [id]", defaultCommand: "acctcreated",
    run: async ({ args, msg, client }) => { const id = (args[0] || msg.author.id).replace(/[<@!>]/g, ""); const u = await client.users.fetch(id).catch(() => null); return u ? `<t:${Math.floor(u.createdTimestamp / 1000)}:F>` : "not found"; } });
  cmd({ id: "i_first", name: "First message", description: "First message in this channel.", defaultCommand: "first",
    run: async ({ msg }) => { const msgs = await msg.channel.messages.fetch({ after: "0", limit: 1 }).catch(() => null); const m = msgs?.first(); return m ? `${m.url}\n@${m.author.username}: ${clip(m.content, 300)}` : "none"; } });
  cmd({ id: "i_jump", name: "Jump link", description: "jump <messageId>", defaultCommand: "jump",
    run: ({ args, msg }) => `https://discord.com/channels/${msg.guild?.id || "@me"}/${msg.channel.id}/${args[0]}` });
  cmd({ id: "i_mention", name: "User mention", description: "mention <id>", defaultCommand: "mention",
    run: ({ args }) => `<@${args[0]}>` });
  cmd({ id: "i_chmention", name: "Channel mention", description: "chmention <id>", defaultCommand: "chmention",
    run: ({ args }) => `<#${args[0]}>` });
  cmd({ id: "i_rolemention", name: "Role mention", description: "rolemention <id>", defaultCommand: "rolemention",
    run: ({ args }) => `<@&${args[0]}>` });
  cmd({ id: "i_emojiid", name: "Emoji info", description: "emojiinfo <name|id>", defaultCommand: "emojiinfo",
    run: ({ args, msg }) => { const q = (args[0] || "").toLowerCase(); const e = msg.guild?.emojis.cache.find((x) => x.name.toLowerCase() === q || x.id === q); return e ? `${e.toString()} · \`${e.id}\` · ${e.url}` : "not found"; } });
  cmd({ id: "i_avatarme", name: "My avatar", description: "Your avatar URL.", defaultCommand: "me",
    run: ({ msg }) => msg.author.displayAvatarURL({ size: 1024 }) });

  /* ---------- discord actions (25) ---------- */
  cmd({ id: "d_pin", name: "Pin reply", description: "Reply to a message, then run.", defaultCommand: "pin",
    run: async ({ msg }) => { const r = await msg.fetchReference().catch(() => null); if (r) await r.pin().catch(() => {}); await msg.delete().catch(() => {}); } });
  cmd({ id: "d_unpin", name: "Unpin reply", description: "Reply then unpin.", defaultCommand: "unpin",
    run: async ({ msg }) => { const r = await msg.fetchReference().catch(() => null); if (r) await r.unpin().catch(() => {}); await msg.delete().catch(() => {}); } });
  cmd({ id: "d_star", name: "Star (⭐)", description: "React ⭐ to replied msg.", defaultCommand: "star",
    run: async ({ msg }) => { const r = await msg.fetchReference().catch(() => null); if (r) await r.react("⭐").catch(() => {}); await msg.delete().catch(() => {}); } });
  cmd({ id: "d_heart", name: "React ❤️", description: "React ❤️.", defaultCommand: "heart",
    run: async ({ msg }) => { const r = await msg.fetchReference().catch(() => null); if (r) await r.react("❤️").catch(() => {}); await msg.delete().catch(() => {}); } });
  cmd({ id: "d_fire", name: "React 🔥", description: "React 🔥.", defaultCommand: "fire",
    run: async ({ msg }) => { const r = await msg.fetchReference().catch(() => null); if (r) await r.react("🔥").catch(() => {}); await msg.delete().catch(() => {}); } });
  cmd({ id: "d_skull", name: "React 💀", description: "React 💀.", defaultCommand: "skull",
    run: async ({ msg }) => { const r = await msg.fetchReference().catch(() => null); if (r) await r.react("💀").catch(() => {}); await msg.delete().catch(() => {}); } });
  cmd({ id: "d_bookmark", name: "Bookmark", description: "Reply then run — DMs you the link.", defaultCommand: "bookmark",
    run: async ({ msg, client }) => { const r = await msg.fetchReference().catch(() => null); if (!r) return "reply to a message first."; const me = await client.users.fetch(msg.author.id); await me.send(`🔖 ${r.url}\n@${r.author.username}: ${clip(r.content, 500)}`).catch(() => {}); await msg.delete().catch(() => {}); } });
  cmd({ id: "d_lastmine", name: "Delete last mine", description: "Delete your last message here.", defaultCommand: "delme",
    run: async ({ msg }) => { const msgs = await msg.channel.messages.fetch({ limit: 50 }).catch(() => null); const m = msgs?.filter((x) => x.author.id === msg.author.id && x.id !== msg.id).first(); if (m) await m.delete().catch(() => {}); await msg.delete().catch(() => {}); } });
  cmd({ id: "d_editlast", name: "Edit last mine", description: "editlast <newtext>", defaultCommand: "editlast",
    run: async ({ msg, args }) => { const msgs = await msg.channel.messages.fetch({ limit: 50 }).catch(() => null); const m = msgs?.filter((x) => x.author.id === msg.author.id && x.id !== msg.id).first(); if (m) await m.edit(joined(args)).catch(() => {}); await msg.delete().catch(() => {}); } });
  cmd({ id: "d_editreply", name: "Edit replied mine", description: "Reply to your own msg then editreply <text>", defaultCommand: "editreply",
    run: async ({ msg, args }) => { const r = await msg.fetchReference().catch(() => null); if (r?.author.id === msg.author.id) await r.edit(joined(args)).catch(() => {}); await msg.delete().catch(() => {}); } });
  cmd({ id: "d_nick", name: "Set nickname", description: "nick <text>", defaultCommand: "nick",
    run: async ({ msg, args }) => { await msg.member?.setNickname(joined(args)).catch(() => {}); return "done."; } });
  for (const [name, status] of [["online","online"],["idle","idle"],["dnd","dnd"],["invisible","invisible"]]) {
    cmd({ id: `d_${name}`, name: `status · ${name}`, description: `Set status to ${status}.`, defaultCommand: name,
      run: async ({ client }) => { await client.user.setStatus(status).catch(() => {}); return `→ ${status}`; } });
  }
  cmd({ id: "d_activity", name: "Set activity", description: "activity <text>", defaultCommand: "activity",
    run: async ({ client, args }) => { await client.user.setActivity(joined(args), { type: 4 }).catch(() => {}); return "set."; } });
  cmd({ id: "d_clearact", name: "Clear activity", description: "Clear custom status.", defaultCommand: "clearact",
    run: async ({ client }) => { await client.user.setActivity("", { type: 4 }).catch(() => {}); return "cleared."; } });
  cmd({ id: "d_leave", name: "Leave server", description: "Leave the current server.", defaultCommand: "leavehere",
    run: async ({ msg }) => { if (!msg.guild) return "not in a server."; await msg.guild.leave().catch(() => {}); } });
  cmd({ id: "d_remind", name: "Remind me", description: "remind <seconds> <text>", defaultCommand: "remind",
    run: async ({ args, msg, client }) => { const secs = Math.min(Math.max(+args[0] || 60, 1), 86400); const text = args.slice(1).join(" ") || "reminder"; setTimeout(async () => { const me = await client.users.fetch(msg.author.id).catch(() => null); me?.send(`⏰ ${text}`).catch(() => {}); }, secs * 1000); return `⏰ in ${secs}s.`; } });
  cmd({ id: "d_countdown", name: "Countdown", description: "countdown <seconds>", defaultCommand: "countdown",
    run: async ({ args, msg }) => { const secs = Math.min(Math.max(+args[0] || 10, 1), 60); const m = await msg.channel.send(`⏳ ${secs}`); for (let i = secs - 1; i >= 0; i--) { await new Promise((r) => setTimeout(r, 1000)); await m.edit(i > 0 ? `⏳ ${i}` : "⏰ time!").catch(() => {}); } } });
  cmd({ id: "d_afkon", name: "Set AFK status", description: "Sets DND + AFK activity text.", defaultCommand: "afkstatus",
    run: async ({ client, args }) => { await client.user.setStatus("idle"); await client.user.setActivity(`afk — ${joined(args) || "brb"}`, { type: 4 }); return "afk on."; } });
  cmd({ id: "d_typinghere", name: "Typing here", description: "Show typing indicator once.", defaultCommand: "typing",
    run: async ({ msg }) => { await msg.channel.sendTyping().catch(() => {}); await msg.delete().catch(() => {}); } });

  /* ---------- markdown / text art (20) ---------- */
  cmd({ id: "md_bold", name: "**bold**", description: "bold <text>", defaultCommand: "bold", run: ({ args }) => `**${joined(args)}**` });
  cmd({ id: "md_italic", name: "*italic*", description: "italic <text>", defaultCommand: "italic", run: ({ args }) => `*${joined(args)}*` });
  cmd({ id: "md_under", name: "__underline__", description: "underline <text>", defaultCommand: "underline", run: ({ args }) => `__${joined(args)}__` });
  cmd({ id: "md_strike", name: "~~strike~~", description: "strike <text>", defaultCommand: "strike", run: ({ args }) => `~~${joined(args)}~~` });
  cmd({ id: "md_spoiler", name: "||spoiler||", description: "spoiler <text>", defaultCommand: "spoiler", run: ({ args }) => `||${joined(args)}||` });
  cmd({ id: "md_spoilwall", name: "Spoiler wall", description: "Per-char spoilers.", defaultCommand: "spoilwall",
    run: ({ args }) => [...joined(args)].map((c) => `||${c}||`).join("") });
  cmd({ id: "md_header", name: "# Header", description: "header <text>", defaultCommand: "header", run: ({ args }) => `# ${joined(args)}` });
  cmd({ id: "md_h2", name: "## Header2", description: "h2 <text>", defaultCommand: "h2", run: ({ args }) => `## ${joined(args)}` });
  cmd({ id: "md_h3", name: "### Header3", description: "h3 <text>", defaultCommand: "h3", run: ({ args }) => `### ${joined(args)}` });
  cmd({ id: "md_quote", name: "> Quote", description: "quote <text>", defaultCommand: "quotem",
    run: ({ args }) => joined(args).split("\n").map((l) => `> ${l}`).join("\n") });
  cmd({ id: "md_code", name: "`code`", description: "code <text>", defaultCommand: "code", run: ({ args }) => `\`${joined(args)}\`` });
  cmd({ id: "md_codeblock", name: "```block```", description: "codeblock <lang>|<text>", defaultCommand: "codeblock",
    run: ({ args }) => { const [lang, ...rest] = joined(args).split("|"); return "```" + lang.trim() + "\n" + rest.join("|") + "\n```"; } });
  cmd({ id: "md_mono", name: "Monospaced block", description: "mono <text>", defaultCommand: "mono", run: ({ args }) => "```\n" + joined(args) + "\n```" });
  cmd({ id: "md_list", name: "Bullet list", description: "list a | b | c", defaultCommand: "list",
    run: ({ args }) => joined(args).split("|").map((s) => `• ${s.trim()}`).join("\n") });
  cmd({ id: "md_num", name: "Numbered list", description: "numlist a | b | c", defaultCommand: "numlist",
    run: ({ args }) => joined(args).split("|").map((s, i) => `${i + 1}. ${s.trim()}`).join("\n") });
  cmd({ id: "md_box", name: "ASCII box", description: "box <text>", defaultCommand: "box",
    run: ({ args }) => { const t = joined(args); const line = "─".repeat(t.length + 2); return "```\n┌" + line + "┐\n│ " + t + " │\n└" + line + "┘\n```"; } });
  cmd({ id: "md_rainbow", name: "ANSI rainbow", description: "rainbow <text>", defaultCommand: "rainbow",
    run: ({ args }) => { const cs = [31,33,32,36,34,35]; const t = joined(args); return "```ansi\n" + [...t].map((c, i) => `\u001b[1;${cs[i % cs.length]}m${c}`).join("") + "\u001b[0m\n```"; } });
  cmd({ id: "md_gradient", name: "ANSI gradient", description: "gradient <text>", defaultCommand: "gradient",
    run: ({ args }) => { const cs = [31,33,32,36,34]; const t = joined(args); return "```ansi\n" + [...t].map((c, i) => `\u001b[1;${cs[Math.floor(i / Math.max(1, t.length / cs.length)) % cs.length]}m${c}`).join("") + "\u001b[0m\n```"; } });
  cmd({ id: "md_bigemoji", name: "Regional big text", description: "Emoji-letter text.", defaultCommand: "bigtext",
    run: ({ args }) => [...joined(args).toLowerCase()].map((c) => /[a-z]/.test(c) ? `:regional_indicator_${c}:` : c === " " ? "   " : c).join(" ") });
  cmd({ id: "md_reverseblock", name: "Reversed codeblock", description: "revblock <text>", defaultCommand: "revblock",
    run: ({ args }) => "```\n" + joined(args).split("").reverse().join("") + "\n```" });

  /* Small companion: reload safety — always return true so downstream plugins don't handle. */
}
