Design a polished, professional UI for **Sports Radar (רדאר ספורט)** — a real-time news radar used all day by the content editors of **Sport5 (sport5.co.il)**, Israel's leading sports channel. It is a working tool, not a consumer news site: editors scan it to decide in seconds what to write next, then copy the story into Sport5's CMS.

## Who uses it and how
- Sport5 web editors on a **desktop at the desk** (most of the shift) and on a **phone** (on the go, night shifts).
- Their questions, in order, for every story: *Is it important? Did Sport5 already cover it? Who reported it and how fresh is it? What exactly happened?* — then one action: copy for the site / send by mail / WhatsApp / "I'm on it".
- World news matters as much as Israeli news (Premier League, LaLiga, Champions League, NBA, EuroLeague, transfers, viral stories, plus Israeli players abroad).

## Hard constraints
- **Hebrew, right-to-left** (with an English UI option). Mixed Hebrew/English text everywhere (an original English headline sits under its Hebrew translation).
- **Sport5's visual world:** dark navy top bar `#141c27`, Sport5 magenta `#c4004f` (dark mode `#ff3d86`), white/very light grey surfaces, Heebo (bold 800–900 for headlines). Square-ish corners (2–4px), no heavy shadows, no gradients.
- Light **and** dark themes (a theme toggle exists).
- Dense but calm: an editor must see 6–8 stories per desktop screen without clutter.
- Real buttons, 44px touch targets on phone, 4.5:1 text contrast, drawn line icons (no emoji as icons).

## What to design (artboards)
1. **Desktop home (1440 wide)** — header (logo "רדאר ספורט", live status "updated 2 min ago", Telegram, report, alerts, keyboard-shortcuts, theme, EN), category tabs with counts (הכי חם · בשבילך · כדורגל ישראלי · כדורסל ישראלי · ישראלים בחו״ל · כדורגל עולמי · כדורסל עולמי · אולימפי וענפים אחרים), a search box, a "not on Sport5 only" toggle, and a compact filter row (League ▾ · Time: any/hour/3h/today · Source type ▾). Main column: the story feed. Side column (400px): tabs Scores / Just in / Trends.
2. **Phone home (390×844)** — same content; filters behind a single "filters" button; bottom navigation: News · Scores · Just in · Trends.
3. **The story card — the heart of the product.** Show 3 variants and recommend one. Each card holds:
   - **Sport5 status** (the most important signal): *not found on Sport5* / *on the Sport5 site* / *on Sport5 since, +N newer posts* / *only on Sport5's Telegram/YouTube*.
   - up to 2–3 small labels: scoop (reporter name), hot, sport, 1–2 topics (club/player/competition).
   - Hebrew headline (bold), original headline in grey under it (when translated), one-line AI summary that expands to 2–3 sentences + key facts + up to 2 quotes (each quote with its own copy button).
   - source name + "+N sources", clock time + "12 min ago".
   - actions: 👍/👎 (worth covering?), "I'm on it" (claims the story for the team, shows "Dana is on it"), copy for the site, mail to web@sport5.co.il, WhatsApp, copy embed code (when there's a video), wrong category.
   - optional small thumbnail.
   - a thin marker for "new since your last visit".
4. **Search results** — radar results first (best match), then a separate section **"From the web — Google News"** (Hebrew-translated headline, original, source, time, copy/mail/WhatsApp) with a button **"Follow in the radar for 6 hours"**.
5. **Trends panel** — "What people search for on Google" (in Israel / worldwide; each term with volume, country chips, Google's headline, and either "3 stories in the radar" (expandable) or "no story yet — the radar is searching"), "Most read on Wikipedia yesterday", "Israelis abroad — page views jumped ×9.7", "Hot on Reddit".
6. **Morning brief card** (07:00–12:00, top of "Hot"): "☀️ Good morning — what happened overnight", 10 numbered stories with time, sport icon, Hebrew headline, source; "hide until tomorrow".
7. **"My topics" card** (top of "For you"): the editor's followed topics as chips with new-story counts, and a prominent "+ Follow a new topic" button; the topic editor dialog (name, words, must include, exclude, sites, alert on/off).
8. **Empty, loading and error states**, and a toast ("Copied — ready to paste").

## Real sample content (use it, don't invent lorem ipsum)
- "קארל אנתוני טאונס על הארכת חוזה לפני העונה: ״זה לא נראה טוב״" — original: "Knicks' Karl-Anthony Towns on extension before season: 'It don't look good'" — The Athletic +6 · 18:51 · not found on Sport5 · quote: ״זה לא נראה טוב״ — קארל אנתוני טאונס.
- "״רבתי עם דודה שלי״: מה עיצבן את אמבפה?" — Sport5 +4 · 17:15 · on the Sport5 site.
- "אלכס סקוט עוזב את מחנה נבחרת אנגליה: חשש שהפציעה תשבית אותו לחודשיים" — scoop · David Ornstein · The Athletic +4 · 11:11 · not found on Sport5.
- Trend: "carlos alcaraz · 20K+ · Spain, Italy, UK · 2 stories in the radar".

## Design goals
- **Status first:** Sport5 coverage and freshness readable at a glance (colour + text, never colour alone).
- **Scan, then act:** headline hierarchy so strong that skimming 50 stories is effortless; actions always reachable but visually quiet until hover/focus.
- **One system:** consistent tokens (colour, type scale, spacing 4/8, radius), consistent chips/labels/buttons across feed, panels and dialogs.
- Feel like a professional newsroom tool (think Bloomberg terminal clarity meets Sport5 branding), not a social feed.

Deliver the artboards above plus a small style sheet artboard (colours light/dark, type scale, chips/labels, buttons, icons). Note your recommendation for the card and why.
