```
BEFORE (frozen pre-Step-1 grouping) → NOW, same data, editor-approved rules
  precision %                                                  34.4 →     66.7
  recall %                                                     55.9 →     50.8
  false merges (of 180 "different")                              63 →       15
  missed merges (of 59 "same")                                   26 →       29
  correct merges                                                 33 →       30
  two phases of one match in one story (of 32)                   16 →        2
  separate follow-ups joined (of 28)                             10 →        3
  "review" pairs in one story (of 25, not scored)                 8 →        4
  synthetic: false merges (of 12)                                 4 →        1
  synthetic: missed merges (of 12)                                0 →        0
  stories                                                       349 →     1091
  biggest story (articles)                                      721 →      249
  stories over 100 articles                                      15 →       14
  stories over 50 outlets                                        15 →       13
  stories spanning over 24 hours                                 43 →       28
  longest story span (hours)                                     48 →       35
  word groups that grew for over 20 hours                        55 →       33
  longest word group (hours)                                     48 →       35
  over time: articles that changed story id %                   1.6 →      1.7
  over time: stories that lost their id                          71 →       49
  over time: stories that look new again                         12 →       41
    of them young enough for Telegram (under 3h)                  0 →        2
  one grouping run (ms, this machine)                           325 →      467
The switch itself (old stories, then one run of the new grouping): 4450 of 7441 articles change story id (59.8%), 2 stories lose their id, 339 look new (6 of them under 3 hours old).

FALSE MERGES FIXED (different, were in one story, now apart): 49
  r001 multilingual (two separate pre-match press conferences (Hoeness, Simeone))
     [de] BILD: VfB Stuttgart against Atletico: Hoeneß ennobles Simeone before a direct duel
     [es] El Desmarque: Simeone responds to Cuti Romero's injury and the competition between Johnny Cardoso and Hjulmand
  r006 multilingual
     [pt] ge: Amapaense Table Tennis Championship ends with 50 podiums in the last stage
     [nl] De Telegraaf: Sarina Wiegman (56) rewarded by the English association for performance: success coach extends contract and ai
  r012 multilingual
     [fr] We Love Tennis: ATP - Shanghai > Alexander Zverev, after his elimination: "I think it's the most difficult shot in tennis when
     [en] TSN: ATP 1000 Tennis: Shanghai - Final
  r017 multilingual
     [es] SPORT: MotoGP Australian GP: schedules and where to watch the races with Marc Márquez and Jorge Martín on TV
     [en] GPFans: Mercedes set to bring major upgrade to US Grand Prix after recent struggles
  r021 multilingual
     [de] SPORT1: Next Spurs bang for Richarlison
     [en] Yahoo Sports: Report De Zerbi targets Endrick and a new Italian arrival at Tottenham
  r024 multilingual (live coverage vs. a TV listing before the game)
     [en] Sky Sports: NFL London LIVE! Texans strike again vs Jags at Wembley
     [de] dslweb: NFL London Game live on RTL: Today Texans vs Jaguars live from 3 p.m. on Free TV
  r025 multilingual
     [tr] A Spor: Muhammed Salah is at the top of the top scorer list!
     [es] La Vanguardia: Bundesliga 2026-2027: top scorer and top assistant after matchday 6
  r026 multilingual (the coach skips training vs. a later piece on the cost of sacking him)
     [it] TuttoMercatoWeb: How much would it cost Napoli to sack Massimiliano Allegri?
     [en] Football Italia: Allegri did not lead Napoli training after Venezia loss and faces increasing risk of sack
  r027 multilingual (a possible trade vs. a piece on why the club will not release the player)
     [en] ClutchPoints: NBA rumors: Kings eyeing Grizzlies trade after Ben Simmons’ season-ending injury
     [de] kicker: Why the Kings won't release Simmons despite his injury
  r032 multilingual (City's team news vs. the AEK coach's press conference)
     [en] Yahoo Sports: A picture emerges of which Manchester City players are available for AEK Athens clash
     [el] Sportal: Live streaming: Nikolic's press conference ahead of Manchester City - AEK
  r038 multilingual
     [pt] 365Scores: Brasileirão 2026: List of top scorers and goalscorers
     [de] BILD: Lech Poznań vs. Bayer Leverkusen Lineup - Europa League 2nd Matchday League Phase 2026/2027
  r042 multilingual (a disciplinary case about the fans vs. the match itself)
     [nl] Eindhovens Dagblad: Misconduct Ajax opponent Hajduk Split gets a tail: fans charged for anti-Semitic and Nazi slogans
     [en] TOD: Watch Hajduk Split vs Ajax
  r047 big-cluster (line-up vs. result)
     [he] ONE: דיומנדה ואנדריק ב-11 של מוריניו מול סביליה
     [sr] Sportski žurnal: Real convincingly beat Sevilla, two goals from Mbappe
  r048 big-cluster
     [pl] Meczyki.pl: Match squads ŁKS Łódź - Podbeskidzie - 18/10/2026
     [en] Football Italia: Moggi: ‘Juventus lack a coach, the team didn’t play at all against Lazio’
  r049 big-cluster
     [it] Firenze Viola: At 8.45pm there is Juventus-Lazio: here are the official lineups for the match
     [de] Eurosport: Road race men, 5th stage, Arnhem - Arnhem 18/10/2026
  r050 big-cluster (a pundit's comment the next day vs. the match result)
     [it] TuttoMercatoWeb: Moggi: "Juventus lacks a coach. Everyone thinks about their own backyard"
     [he] ONE: נצמדה לפסגה: לאציו שנייה אחרי 0:3 על יובנטוס
  r054 big-cluster (a pundit after the game vs. the confirmed line-up)
     [en] Yahoo: Gary Neville admits Leeds fans won't like his Tarik Muharemovic claim after draw vs Man United
     [en] Yahoo Sports: Confirmed Man United XI vs Leeds United: Rashford, Heaven dropped, Amad returns
  r055 big-cluster (preview vs. live round-up)
     [en] Sports Mole: Leeds vs. Man Utd: Two reasons why Daniel Farke can defeat Michael Carrick in Premier League battle
     [en] Yahoo Sports: Man Utd and Leeds level; Brighton flying against Palace in PL
  r056 big-cluster (line-ups vs. live score)
     [bg] Sportal.bg: The lineups of Milan and Atalanta, Vladimirov is on the bench for the Rossoneri
     [bg] Sportal.bg: Milan 2:0 Atalanta, the second half has started
  r058 big-cluster
     [it] TuttoMercatoWeb: Atalanta, motorized to Milan to support the Nerazzurri before San Siro: the reconstruction
     [en] ESPN: Al-Khaldiya SC 2026-27 Squad
  r059 big-cluster
     [en] ESPN: Pakhtakor 2026-27 Squad
     [it] Calciomercato: Milan dominates, then suffers in the final: 3-2 to Atalanta, Amorim fourth and -4 behind Inter
  r061 big-cluster (the coach's future after the defeat vs. a match discussion page)
     [en] Yahoo: Crystal Palace left with 'no choice' but to sack Pierre Sage - 'You can't survive that'
     [nl] VoetbalPrimeur: Join the conversation on VP: Brighton – Crystal Palace
  r064 big-cluster (live score vs. the result)
     [he] וואלה ספורט: חי בספורט1: נוטינגהאם פורסט - ארסנל 1:0 (מחצית 2)
     [el] Novasports: Nottingham Forest-Arsenal 0-1: Redemption in the 80′ with Madueke!
  r068 big-cluster
     [pl] Meczyki.pl: Tianjin Teda - Shanghai SIPG - H2H, form, head-to-head
     [en] Read Tottenham: ‘Sharp’ – James Maddison names the most skillful Tottenham player
  r069 big-cluster (a live game vs. a squad return announced the day before)
     [de] kicker: LIVE! After Coventry's equalizer: Marmoush scores to give Spurs the lead again
     [en] BBC: Dejan Kulusevski returns to the Tottenham Hotspur squad
  r070 big-cluster (confirmed line-up vs. "as it happened" after the game)
     [en] USA Today: Tottenham confirmed lineup vs. Coventry City: Starting XI, team news
     [en] The Guardian: Tottenham beat Coventry to claim first Premier League win of season – as it happened
  r071 big-cluster
     [en] Football London: Tottenham press conference LIVE - De Zerbi on Porro, Kulusevski, Richarlison and Marbella training
     [el] Foxbet.gr: What time does Niki Volou - Panionios play today and on which channel?
  r072 big-cluster (away-fans ticket news vs. a preview)
     [it] Cagliari News 24: Monza Cagliari, red and blue guest sector! 1,200 attendances exceeded
     [it] Tutto Cagliari: Monza-Cagliari, a challenge between opposing ambitions: the rossoblù want to continue to amaze
  r073 big-cluster (prediction vs. live page)
     [fr] RueDesJoueurs: Monza Cagliari Prediction – Serie A (10/19/2026)
     [fr] Eurosport: Monza - Cagliari other matches: live Football updates
  r074 big-cluster
     [it] Tutto Cagliari: Cagliari, the players called up for Monza: Pisacane calls 25 rossoblù
     [pt] Diário do Nordeste: Monday games on TV: see where to watch and times for this Monday's matches (19)
  r076 big-cluster (who scored vs. planned changes before the game)
     [tr] GZT: Trabzonspor - Beşiktaş match score, statistics: Who scored the goals in the Trabzonspor - Beşiktaş match?
     [tr] https://www.babaocagi.com/: 3 changes in Beşiktaş before the Trabzonspor match! Here are the top 11 plans
  r077 big-cluster (the under-19 match vs. the first team's match)
     [tr] Haberler: Beşiktaş U19 beat Trabzonspor U19
     [tr] NTVSpor: Decision for Vlahovic and Cerny in Beşiktaş! The camp squad for the Trabzonspor match has been announced
  r078 big-cluster (a TV listing vs. the club president's interview)
     [tr] Yeni Şafak: At what time and on which channel is the Trabzonspor-Beşiktaş match? Where to watch TS BJK derby without passw
     [tr] A Spor: Trabzonspor President Ertuğrul Doğan spoke to A Spor! We will beat Beşiktaş - Aspor
  r083 big-cluster (how the debut went vs. the official line-ups)
     [it] DAZN: How Alaba's debut as a starter went in Udinese-Lecce: 45 minutes of nightmare, then the change at half-time
     [it] 11contro11: Udinese-Lecce, the official lineups
  r084 big-cluster (live score vs. a player's praise after the game)
     [he] ספורט 1: חי בספורט2: גלוך פתח, כרונינגן – אייאקס 4:1 (מחצית 2)
     [en] roundtable.io: Jorthy Mokio Praises Ajax's Performance Against FC Groningen: "More Dynamic..."
  r085 big-cluster (the penalty moments in pictures vs. a live blog)
     [nl] Voetbal International: The four penalty moments at FC Groningen - Ajax in pictures
     [nl] NU.nl: Live Premier League | Cambuur with ten men against AZ, Ajax starts with Leonardo in Groningen
  r087 big-cluster (Ajax's match vs. Jong Ajax's match)
     [nl] NU.nl: Live Premier League | Ajax with striker Leonardo on the hunt for victory in Groningen
     [nl] VoetbalPrimeur: Join the discussion on VP: Jong Ajax – De Graafschap
  r089 big-cluster
     [ro] Gazeta Sporturilor: Four goals in Fiorentina - Como, duel in Serie A » Radu Drăgușin is the starter
     [pt] Terra: Vila Nova x Novorizontino: where to watch, lineups and refereeing
  r090 big-cluster (a TV / streaming listing vs. the result)
     [it] musicletter: ⚽ Fiorentina-Como, Serie A: live football TV streaming 🛑 Breaking news 📆 Sunday 18 October 2026
     [el] Novasports: Fiorentina – Como 1-3: Victory with another goal by Douvika! (highlights)
  r092 big-cluster (a coach's remark about his rival vs. injury news of the same club)
     [ro] Digi Sport: The "reply" came! Hansi Flick described Luis Enrique in one word before PSG - Barcelona
     [he] ספורט 1: מכה כפולה לברצלונה: שני שחקנים ייעדרו מול פ.ס.ז', גם הקלאסיקו בסכנה
  r093 big-cluster
     [el] Sport24: Barcelona v Real Madrid battle for Stuttgart's German wonderkid Finn Jeltz
     [nl] Voetbal International: Barcelona possibly with Frenkie de Jong as defender against PSG
  r094 big-cluster (a surprise call-up vs. the injuries that caused it)
     [es] Mundo Deportivo: Àlex Campos, Flick's surprise in the call to visit PSG
     [fr] Le Parisien: PSG-Barcelona: Éric Garcia and Jules Koundé forfeit against the Parisians in the Champions League
  r095 big-cluster (a surprise call-up vs. the injuries that caused it)
     [es] Mundo Deportivo: Àlex Campos, Flick's surprise in the call to visit PSG
     [fr] Circus Daily: One absent at PSG, two at Barça: rain of injuries before PSG-Barcelona
  r277 late-source (a real-time page vs. an anecdote from half-time told afterwards)
     [pt] LANCE!: Real Time | Bologna x Inter Milan
     [it] Napoli Magazine: GAZZETTA - Inter, Chivu loses his voice during half-time in Bologna and wakes up the team
  r279 late-source (two different matches of the same club)
     [de] Sportschau: Listen live: Dynamo Dresden vs. 1. FC Magdeburg - 2. Bundesliga
     [pl] Meczyki.pl: Kiel - SG Dynamo Dresden: types, odds, absences, preview - 25/10/2026
  r280 late-source (Cincinnati college football vs. FC Cincinnati)
     [en] TSN: Texas Tech Red Raiders vs. Cincinnati Bearcats - 2026-10-24
     [en] OneFootball: Highlights: FC Cincinnati 0-2 Columbus Crew (MLS)
  r282 late-source
     [en] The Stats Zone: Lilli Tagger vs Liudmila Samsonova Preview & Prediction | 2026 Japan Women’s Open | First Round
     [en] SSBCrack: Heavy Rain Halts Katie Boulter’s Match at Japan Women’s Open
  r283 late-source
     [en] Yahoo Sports: 🎥 At 39, Messi averages a goal a game since the World Cup
     [fr] RTBF: 'Oh my God': Brighton fan announces world-class goal two days in advance
  r286 late-source
     [nl] Voetbal International: VI Live: packed football Sunday with IJsselderby, Arsenal and Real Madrid
     [tr] Goal.com: Claim from Jose Mourinho for Vinicius Jr, who is linked with Arsenal: He should have left Real Madrid to go to

NEW FALSE MERGES (different, were apart, now in one story): 1
  r289 late-source (a goal clip during the game vs. a team-mate's quote after it)
     [en] MLSsoccer.com: Goal: A. Griezmann vs. D.C. United, 15'
     [fr] L'Équipe: Ojeda: “Griezmann makes football easier”

CORRECT MERGES LOST (same, were in one story, now apart): 3
  r065 big-cluster (two live blogs of the same match)
     [en] The Athletic: Nottingham Forest vs Arsenal latest plus reaction to Manchester United’s draw with Leeds: Live updates
     [en] BBC: Premier League LIVE: Arsenal beat Forest after Man Utd & Leeds draw, Brighton and Bournemouth win
  r088 big-cluster
     [el] Sportal: Douvikas "struck" with a nice finish for Como's 3-1 win against Fiorentina (vid)
     [el] Novasports: Fiorentina – Como 1-3: Victory with another goal by Douvika! (highlights)
  r291 late-source
     [es] Mundo Deportivo: Wanda Nara takes revenge on Icardi: "I'm selling a little-used Argentina shirt for 12 euros"
     [el] Sportal: Wanda Nara sells Mauro Icardi's shirt for just 12 euros - The description that went viral

CORRECT MERGES GAINED (same, were apart, now in one story): 0

"REVIEW" PAIRS THAT CHANGED (not scored): 4
  r029 multilingual (a statistics page (phase unclear) vs. a preview)
     [fr] Eurosport: Deportivo Cali - Junior Statistics: Football Scores & Results
     [es] Noticias Coopercom: With no margin for error, Junior seeks to survive against Deportivo Cali
  r046 big-cluster (the result report vs. the losing coach's post-match quote: does a reaction belong in the report's story?)
     [he] הארץ: ריאל מדריד הביסה את סביליה 1:4 ושמרה על מאזן מושלם בברנבאו
     [es] Marca: García Plaza: "Maybe they didn't want there to be more points distance for the Classic if we won"
  r062 big-cluster (fans' say after the game vs. a goal clip; unclear if the clip ran during or after the game)
     [en] BBC: Brighton 5-0 Crystal Palace: Have your say
     [en] Sports Mole: Watch Brighton's Diego Gomez score 51m halfway line goal in Crystal Palace M23 derby
  r082 big-cluster (the result report vs. a next-day analysis)
     [it] Lifestyleblog.it: Udinese-Lecce 0-3, Di Francesco conquers Bluenergy: Gaspar and N'Dri on inactive ball, Siebert closes on the c
     [it] TuttoMercatoWeb: The ugliest Udinese of the three-year period: Lecce plays and has fun at home in Friuli

SYNTHETIC PAIRS THAT CHANGED: 3
  s20 synthetic (the preview and the result of one match (different phases))
     [en] Football Wire: Lakeside FC vs Northgate Rovers: preview, team news and predicted line-ups
     [en] Football Wire: Lakeside FC 2-0 Northgate Rovers: Hart and Silva send the hosts top
  s21 synthetic (the live coverage and the result of one match (different phases))
     [en] The Daily Ball: Lakeside FC v Northgate Rovers LIVE: Hart heads the hosts in front after 20 minutes
     [en] Football Wire: Lakeside FC 2-0 Northgate Rovers: Hart and Silva send the hosts top
  s22 synthetic (the preview and the live coverage of one match (different phases))
     [en] Football Wire: Lakeside FC vs Northgate Rovers: preview, team news and predicted line-ups
     [en] The Daily Ball: Lakeside FC v Northgate Rovers LIVE: Hart heads the hosts in front after 20 minutes
```
