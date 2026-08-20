# Mobile audit - every problem, catalogued

**Date:** 2026-08-19 · **Branch audited:** `feat/chat-donations-install` (chat + donations + install, pre-merge)
**Method:** full mobile screenshot sweep (26 states at 375x812 iPhone emulation, 320px and landscape spot checks, seeded demo data, real login) + a 16-agent swarm: 12 specialist finders over screenshots and source, dedup/rank, adversarial verification of every finding, completeness critic. 99 raw findings -> 63 confirmed, 1 refuted as a test artifact.

Mobile is becoming the primary interface. The direction is already set: mobile-first layouts, new iconography, collapsible top/bottom/side panels and legends. This document is the evidence that direction rests on - the redesign itself is a separate conversation.

## The shape of the problem

The app was built desktop-first and patched down: one 1042-line stylesheet with ten media queries total, and every finding below is downstream of that. Eleven themes:

**1. The map is buried under fixed chrome** (M3, M4, M10, M32, M33, M35, M37, M38, M45) - The core screen loses roughly half its pixels to an always-open legend, HUD, banners, and a legal-links footer - worse at 320px, near-total in landscape.

**2. There is no phone navigation model** (M2, M12, M34) - Header links vanish under 560px with no replacement. A rostered player can't reach my-games from visible chrome; the one persistent 'nav' element exits to the marketing site.

**3. Dialogs are desktop modals, not sheets** (M5, M14, M15, M16, M29, M41, M52, M54) - Centered fixed-height cards that overflow short viewports, hide their own close buttons, fight the keyboard, and offer no touch gestures.

**4. Forms ignore mobile input basics** (M6, M8, M13, M21, M30, M31, M39) - Sub-16px inputs trigger iOS zoom-on-focus everywhere; rows overflow the viewport; the only save button is a full page-scroll away.

**5. Touch is an afterthought to the cursor** (M7, M11, M24, M26, M27, M28, M40, M53, M62) - Sub-44px targets on nearly every control, hover-only features, mouse verbs in copy, destructive actions with no confirmation, gestures that fight the browser.

**6. No coherent icon language** (M22, M36, M50, M51) - Four art styles plus text glyphs and emoji; illegible legend glyphs; 1.5MB+ badge PNGs drawn at 92px.

**7. The PWA is half-shipped** (M9, M48, M49, M59, M60, M61, M63) - Installable, but no safe-area handling, install path only on the splash, wrong theme colors, portrait-locked on Android, iOS quirks unhandled.

**8. Accessibility gaps, one fatal** (M1, M42, M43, M44, M56) - The find-and-join flow is canvas-only - invisible to screen readers and keyboards. Plus px-locked type, AA contrast misses, broken focus traps, silent chat.

**9. Chat doesn't fit the phone it will mostly be used on** (M23, M25, M55) - A 264px window showing 2-3 messages, scroll yanks, frozen timestamps, no delivery feedback.

**10. The splash undersells on the device that matters** (M18, M19, M20, M47, M57, M58) - CTA below the fold, unreadable gallery, no swipe on the carousel, layout shifts mid-read.

**11. Small stuff that reads as unfinished** (M46, M64)

## Severity key

- **blocker** - a class of users cannot use the feature at all
- **major** - significantly degrades the primary phone flow
- **minor** - real friction a phone user hits
- **polish** - visibly unfinished

## The catalogue

### The map is buried under fixed chrome

**M3 · major - Always-on legend + HUD + chrome leave roughly half the portrait map visible, with invisible tap targets under the legend**
- Why it hurts: The map is the product, and half the screen is chrome before the user touches anything; because the legend is pointer-events:none with backdrop blur, badges and flags underneath it are silently tappable but unreadable - invisible tap targets on the app's core screen.
- Evidence: 10-map-initial.png (legend spans ~63-280pt full-width; header ~52pt + HUD peek ~70pt + attribution + footer ~44pt leave ~45-50% unobstructed map on first load); 21-320-map.png (~26% clear map at 320px); 11a-map-hud-expanded.png (expanded sheet takes another 36vh); MapView.tsx:678-688 (six legend rows + propose hint, no collapse control); globals.css:193-209 (.map-legend always rendered, pointer-events:none, mobile rule only shrinks fonts)
- Direction: Collapse the legend to a small toggle chip on phones (mirroring the HUD peek pattern), folding the propose cue into it - this is the core layout problem the collapsible-panels redesign needs to solve.

**M4 · major - Landscape phones get the desktop layout: HUD rail + legend + banner cover ~90-95% of the map**
- Why it hurts: Rotating the phone makes the core screen effectively disappear and un-tappable.
- Evidence: 26-landscape-map.png (812x375: 360px HUD rail, full legend, donate banner, header and footer tile the screen; only a ~33pt map strip visible bottom-right, and the HUD's last FAQ rows clip under the z-30 footer); all mobile adaptations are @media (max-width:560px) (globals.css:169, 207, 264, 462, 776, 904) which an 812px-wide landscape phone never matches, so the desktop .map-hud rail (globals.css:217-229) and .map-legend (193-201) both apply; manifest.ts:26 locks installed users to portrait but browser landscape is unguarded
- Direction: Key the bottom-sheet/collapse behavior off a combined width-or-height query (or pointer:coarse) so landscape phones get the collapsible mobile layout too.

**M10 · major - Fixed banners overlay the legend, HUD, and page content on every app page, and the donate banner's only dismissal is permanent**
- Why it hurts: An eligible user must either donate or permanently opt out of ever being asked just to read the legend, and while the banner is up it occludes whatever content sits beneath it on every page - including controls that then become untappable.
- Evidence: 20-map-with-donate-banner.png (banner hides five of six legend rows, leaving an orphaned 'claimed 96' row); 21-320-map.png (banner + legend remnant push the first clear map pixel to ~285pt of 568); 26-landscape-map.png (banner covers the HUD headline); 24-320-account-full.png / crop-banner-320.png (banner permanently covers the account page's 'find a game' back link - scrolling moves content under the header so it can never be revealed); globals.css:731-737 (.donate-banner fixed top:72 z-20) vs .map-legend top:58-64 z-5 (:193, :208) - .unverified-banner shares the same geometry (:717), though app/(app)/layout.tsx:28 guards remindDonate with !unverified so the two never render together; components/DonationReminderBanner.tsx:73-89 (sole dismiss persists 'declined' for good - no temporary close); banner is mounted from the layout so it follows the user to every app page
- Direction: Add a plain 'later' dismiss and give banners a slot in the layout flow (push the legend/content down) instead of fixed-position overlap.

**M32 · minor - Fixed legal-links footer overlays the register and account forms on every screenful**
- Why it hurts: A permanent bar of five tiny links consumes ~38px of viewport and sits on top of scrolling form content on pages where the user is filling fields, not browsing legal links.
- Evidence: 04-register-full.png (the fixed strip hides the 'your address (optional)' heading mid-capture); crop-footer-375.png from 19-account-full.png (footer painted over the location section, covering the 'zip code' label); globals.css:453-458 (.app-foot position:fixed bottom:0 z-30), :467 (12px links, 9px gaps)
- Direction: Make the footer static/in-flow on form pages, or collapse it behind a toggle per the redesign plan.

**M33 · minor - My-games past-games panel tail is permanently hidden behind the fixed footer**
- Why it hurts: The occluded strip is the panel's own bottom edge, so scrolling inside the panel can never fully reveal the final list item - it reads as a rendering bug.
- Evidence: 18-my-games-full.png (the 'Wed, Jul 15' row clipped by the footer bar and can never scroll clear); globals.css:779 (.mine-right bottom:8px at <=560px) vs .app-foot fixed bottom:0, ~40px tall, z-30 (globals.css:453-458) over the panel's z-6 (:682-686)
- Direction: Dock the panel bottom above the footer height (plus safe-area inset).

**M35 · minor - Expanded HUD sheet covers the zoom control and clips its content with no scroll affordance**
- Why it hurts: While the sheet is open the zoom buttons are visible but untappable behind glass, and the clipped FAQ row is the only hint the sheet scrolls.
- Evidence: 11a-map-hud-expanded.png (faint +/- ghosts behind the panel's right edge ~y=590pt; last FAQ row cut mid-line at the 36vh cap); globals.css:271-287 (.map-hud max-height:36vh overflow-y:auto; .maplibregl-ctrl-group lifted only ~140px from the bottom vs the sheet's ~366px reach)
- Direction: Hide or slide the zoom control while the sheet is open (a data-expanded sibling selector already exists) and add a bottom fade/scroll cue.

**M37 · minor - The collapsed HUD's only expand cue is a tiny low-contrast text caret**
- Why it hurts: The HUD peek is the primary 'what do I do here' surface on a phone and many users won't realize it opens.
- Evidence: 10-map-initial.png (bottom 'there's a game near you' banner: the caret at far right is ~15px and low-contrast, nothing else signals the banner expands); globals.css .map-hud-caret (font-size:15px), components/MapHud.tsx:225
- Direction: Give the collapsed HUD a real chevron icon plus a grabber/sheet affordance.

**M38 · minor - Stock white MapLibre controls clash with the dark theme, sit clipped at the screen edge, and bleed through my-games panels**
- Why it hurts: Bright default widgets float on a fully custom dark map - the (i) looks like a broken help toggle, the clipped pill reads as a rendering bug, and half-visible controls bleeding through the my-games glass panels invite dead taps.
- Evidence: 10-map-initial.png and 21-320-map.png (white attribution (i) pill flush against/overhanging the right edge above the footer); 18-my-games-full.png (+/- pill pokes out half-covered between the upcoming/past panels, (i) behind the panel corner); components/MapView.tsx:194-196 (NavigationControl + compact attribution with default styling); globals.css:285-287, 470-471 (controls repositioned for /play only, never restyled or hidden on overlay pages)
- Direction: Restyle the zoom/attribution controls to match the dark chrome, keep the (i) fully on-screen, hide controls on pages where the map is a backdrop, and consider dropping +/- on touch since pinch-zoom exists.

**M45 · minor - Map data fetch failure is silent with no retry - map shows zero flags until the user pans**
- Why it hurts: On flaky mobile data a failed initial load renders an empty green field with a zeroed legend and no hint anything went wrong - the user has no reason to know panning would fix it.
- Evidence: console-errors.txt lines 7-12 (2x '[map refresh error] TypeError: Failed to fetch'); components/MapView.tsx:283-286 (catch logs and returns - 'try again on next move'), :543-551 (refresh only re-fires on moveend, no timer/backoff, no offline UI)
- Direction: Add a short retry/backoff for the initial load and a small 'can't reach the map right now' notice.

### There is no phone navigation model

**M2 · major - No mobile navigation: header links hidden with no replacement, footer wasted on meta links, my-games unreachable, installed-PWA pages are dead ends**
- Why it hurts: The app's core returning user - a rostered player - cannot reach their weekly game, RSVPs, or any destination from visible chrome; navigation is inverted (permanent bar for legal links, nothing for primary destinations) and content pages become multi-tap scavenger hunts in the installed app.
- Evidence: app/globals.css:173 (.nav nav { display:none } at <=560px hides find-a-game/my-games/account in both layouts); components/AccountMenu.tsx:75-88 (avatar dropdown has no 'my games'); only phone routes to /my-games are a 12px link inside the collapsed HUD (components/MapHud.tsx:269) and account-page link (app/(app)/account/page.tsx:108); the permanent fixed footer holds only faq/privacy/terms/contact/github at 12px/9px gaps (app/(app)/layout.tsx:75-83, globals.css:453-467, comment at :462-466 admits it swallows HUD taps); in the installed PWA (manifest display:standalone, no back UI on iOS) tapping faq from the map leaves escape only via brand -> marketing splash -> avatar -> find a game; ~97px of the 812px viewport is chrome providing zero primary navigation (10-map-initial.png, 18-my-games-full.png, 05-donate-full.png)
- Direction: Replace the app footer with a bottom tab bar (map / my games / account), move legal links behind an about/account sheet, and give content pages an explicit back-to-map affordance; as a stopgap add my-games to the avatar dropdown.

**M12 · minor - Unread-chat indicator is display:none on phones - the only chat notification channel**
- Why it hurts: Game-coordination messages ('field moved', 'we're short this week') are invisible to phone users - the count is fetched and broadcast but the only element that displays it is hidden on the primary interface.
- Evidence: app/(app)/layout.tsx:59-61 (ChatUnreadDot rendered inside <nav>, which globals.css:173 hides at <=560px); components/ChatUnreadDot.tsx:39-41 (comment: with no push and email off by default, the in-app dot is 'the only way a conversation reaches anyone'); grep confirms no other unread UI exists (only layout.tsx and MapHud.tsx reference the count)
- Direction: Surface the unread badge on whatever persistent mobile nav element replaces the hidden header links (e.g. a bottom-tab-bar badge).

**M34 · minor - The only always-visible nav element (the brand link) exits the app to the marketing homepage**
- Why it hurts: With nav links hidden at <=560px, tapping the logo - the natural 'go home' gesture - drops a signed-in phone user onto the landing page, and getting back to the map requires avatar > find a game.
- Evidence: app/(app)/layout.tsx:53 (brand Link href='/'); middleware.ts:8-22 (no signed-in redirect from / to /play); 18-my-games-full.png (header offers nothing else besides the avatar)
- Direction: Point the brand link at /play for signed-in users, or redirect / to /play when authenticated.

### Dialogs are desktop modals, not sheets

**M5 · major - Chat composer is unreachable: below the card's scroll fold on small phones and behind the keyboard when focused**
- Why it hurts: The single thing a chat tab exists for - the input - is off-screen on short viewports (reading as read-only chat), and with the keyboard up the centered card's lower half including the composer sits behind the keyboard, so users type blind or the page jumps.
- Evidence: 23-320-chat.png (320px: no textarea or send button visible - the composer sits past the 80vh card fold behind a nested fixed-height thread); 15-game-modal-chat-composer-focus.png (focused composer, zero layout adaptation); .game-card max-height:80vh overflow-y:auto (globals.css:300) + .chat-thread fixed max-height:264px (globals.css:929-934); modal is position:fixed inset:0 flex-centered against 100vh (components/GameDetailsModal.tsx:203-205); no viewport export / interactive-widget setting anywhere in app/ and no visualViewport listeners in components/ (grep confirmed)
- Direction: Make the chat tab a column layout sized to the card (thread flexes, composer pinned at bottom), size the card with dvh/visualViewport, and add interactive-widget=resizes-content so the composer rides above the keyboard.

**M14 · minor - Game-details and proposed-details close buttons scroll out of view with the card content**
- Why it hurts: Once a phone user scrolls the details card (always necessary - it's taller than 80vh), the only visible dismissal left is the ~15px backdrop slivers beside the 92%-wide card; Escape doesn't exist on a phone.
- Evidence: 12b-game-modal-details-full.png (card fills 80vh and is cut mid-button, so scrolling is mandatory); globals.css:299-307 (.game-card is the scroll container with overflow-y:auto; .game-close is position:absolute top:8px inside it, so it scrolls away with the content); components/GameDetailsModal.tsx:210, same pattern components/ProposedDetailsModal.tsx:161
- Direction: Make the close control sticky/fixed to the card frame (a non-scrolling header bar), or move to a bottom sheet with swipe-down dismiss.

**M15 · minor - ProposeModal has no close button - 'cancel' is below the fold of a form taller than the screen**
- Why it hurts: This modal opens from a long-press on the map - easy to trigger by accident - and backing out requires scrolling through the entire form to find 'cancel' or hitting a 15px backdrop sliver.
- Evidence: 17-propose-modal.png (form cut off at the 'time' field with no X anywhere; submit/cancel off-screen); components/ProposeModal.tsx:233-235 (cancel is the last element of the scrolling form), :148-156 (backdrop tap only on the ~15px slivers left by width:380/maxWidth:92%)
- Direction: Add the same top X the other cards have, kept visible while the form scrolls.

**M16 · minor - Proposed-site card pins to the very top of the screen over the header, with its close X in status-bar/notch territory**
- Why it hurts: The primary dismiss control lands in the hardest spot to reach one-handed on a tall phone (and under the status bar in the installed app); the anchored-popover positioning is a desktop idea that never actually anchors on a phone.
- Evidence: 16-proposed-modal.png / 16b-proposed-modal-full.png (card starts ~8px from the top edge, overlapping the header; X in the extreme top-right corner); components/ProposedDetailsModal.tsx:113-122 (anchor math top = badgeTop - GAP - cardHeight clamped to Math.max(8, top) - a ~600px card never fits above the badge on a phone, so it always clamps to 8px); app/manifest.ts:23 (display standalone - installed users have no browser chrome, putting that corner under the status bar/notch)
- Direction: On narrow viewports skip the anchor math entirely and present the card as a bottom sheet.

**M29 · minor - Auth modal can't scroll and its lower half sits behind the keyboard; the background page scrolls instead**
- Why it hurts: With the keyboard up, the log-in button and 'create an account' link are hidden and the overlay won't scroll - touch-scrolling chains to the page behind the modal, which feels glitchy.
- Evidence: 03-auth-modal.png (card spans ~197-614 of an 812px viewport; iOS keyboard covers from ~476); globals.css:123-127 (.auth-overlay fixed, flex-centered, no overflow-y:auto); components/AuthModal.tsx has no body scroll lock
- Direction: Give the overlay overflow-y:auto with safe-area padding and lock body scroll while the modal is open.

**M41 · minor - vh-based panel and modal caps ignore dynamic browser chrome (no dvh/svh)**
- Why it hurts: With Safari/Chrome URL bars visible, vh is the large viewport, so sheets and modals size themselves taller than the actually-visible area and their bottom edges land under browser chrome.
- Evidence: globals.css:273 (.map-hud max-height 36vh), 776-780 (.mine-panel/.mine-right sized with 50vh), 300 (.game-card 80vh), 432 (.app-body min-height 100vh)
- Direction: Swap the caps to dvh (with vh fallback) during the redesign.

**M52 · polish - Sheet-like cards offer no touch gestures: no swipe-down dismiss, no drag handle, tabs don't respond to horizontal swipe**
- Why it hurts: Phone users instinctively swipe down on a full-height card and swipe sideways between two tabs; both gestures dead-end, which will feel dated once mobile is the primary interface.
- Evidence: components/GameDetailsModal.tsx:203-210 (dismiss = backdrop click, Escape, or X only); components/CardTabs.tsx:27-59 (tab switching is tap + arrow keys - arrow keys don't exist on phones); 12b-game-modal-details-full.png (card visually reads as a full-height sheet)
- Direction: Fold into the planned collapsible-panel redesign: bottom sheet with drag handle, swipeable tab panels.

**M54 · polish - 60%-opaque card surface lets the bright map bleed through modal content**
- Why it hurts: Over bright green map areas the muted-gray text loses contrast and the card looks unfinished - a bigger deal on a phone where the card covers most of the screen over arbitrary map content.
- Evidence: 16-proposed-modal.png (street lines clearly visible through the 'want in?' section and interest buttons); globals.css:19 (--surface: rgba(18,26,48,0.6)), :299-303 (.game-card uses it with blur(10px))
- Direction: Raise surface opacity (or add a solid fallback) at phone widths where the frosted-glass effect has no desktop context to justify it.

### Forms ignore mobile input basics

**M6 · major - Every text input in the app is under 16px - iOS Safari auto-zooms on focus and stays zoomed**
- Why it hurts: Focusing sign-in, register, propose, account, or the chat composer zooms the page ~1.25x and leaves it zoomed after blur, misaligning the fixed map, modals, and chrome - the chat composer inside a centered fixed modal is the worst case, and the whole auth/registration flow is spent pinching the layout back.
- Evidence: globals.css:157 (.auth-form input 15px), 652-661 (.reg-form input/select/textarea 15px - register, account, propose), 346-349 (.game-minplayers-input 14px), 386-390 (.game-confirm-input 14px), 959-964 (.chat-comp textarea 13.5px), 1000-1004 (.map-hud-post-text 12.5px); no viewport export in app/layout.tsx (Next default has no scale handling); 03-auth-modal.png, 17-propose-modal.png, 19-account-full.png, 15-game-modal-chat-composer-focus.png
- Direction: Bump all input/select/textarea font-size to 16px on touch widths - a one-line sweep in globals.css, preferable to capping user zoom.

**M8 · major - City/state and zip rows overflow the viewport in propose and account forms - inputs run off-screen**
- Why it hurts: In the propose-a-game flow (the app's core creation path) the zip field is half unreachable and the form pans sideways; the account location form gets the same horizontal overflow at 375px and 320px.
- Evidence: 17-propose-modal.png (zip field crosses the card border and is clipped by the viewport edge at 375px); crop-citystate-375.png / crop-citystate-320.png and 24-320-account-full.png (state input clipped at the screen edge); globals.css:797-799 (.reg-row > .reg-state flex 0 0 88px with no min-width:0) while .reg-form input (globals.css:652-656) has no width rule, so the ~170-180px intrinsic input width overflows the 88px-basis label; components/ProposeModal.tsx:169-183, app/(app)/account/page.tsx:133-144
- Direction: Give .reg-form inputs width:100% and .reg-row children min-width:0 (or switch the row to grid with 1fr/88px columns) so the flex basis actually constrains them.

**M13 · major - 'Sign up with Google' dead-ends unless the ZIP field five fields below is filled first**
- Why it hurts: The most prominent CTA is the first thing a phone user taps; they complete the Google account chooser and are bounced back with an error telling them to scroll down, enter a ZIP, and do the whole Google dance again.
- Evidence: 04-register-full.png (Google button at top, zip field ~2 screens down); components/GoogleButton.tsx:74 ('enter your zip code first, then continue with google'); components/RegisterInterestForm.tsx:66-69 (GoogleButton mode=signup with getLocation=readLocation)
- Direction: Move the ZIP (the only required location field) above the Google button, or prompt for it inline after Google auth instead of failing.

**M21 · major - The only Save Changes button sits at the top of a ~2100px account page**
- Why it hurts: A phone user who toggles chat-email frequency or the supporter checkboxes at the bottom sees no save control and can leave with unsaved changes, or must scroll 1.5-2 screens back up.
- Evidence: 19-account-full.png (Save directly under the h1; message settings and supporter/reminder checkboxes are the last content ~2 viewport-heights below); globals.css:874-877 (@media max-width:880px makes .acct-save-bar static at top instead of sticky); components/AccountForm.tsx:16-24
- Direction: Make the save bar sticky at the bottom on phones (above the footer) or add a dirty-state floating save.

**M30 · minor - Google button iframe is hard-coded to 300px and overflows the auth card on narrow phones**
- Why it hurts: On 320-360px phones the primary sign-in control pokes past the modal's rounded border or gets clipped, looking broken exactly where trust matters.
- Evidence: components/GoogleButton.tsx:95 (renderButton width:300); globals.css:123-133 - at 360px-wide Androids the card's inner width is ~292px, at 320px ~252px, so the fixed 300px GIS widget overflows the card edge
- Direction: Measure the container and pass its width to renderButton (GIS accepts any px width >= 200).

**M31 · minor - Optional 4-field address block sits between the required ZIP and the submit button**
- Why it hurts: The primary onboarding form reads as 8 required fields plus two legal paragraphs - half of that scroll is optional data, and on a phone that length costs signups.
- Evidence: 04-register-full.png (street address, apt, city, state fill a full screen before 'count me in'); components/RegisterInterestForm.tsx:100-118
- Direction: Collapse the optional address behind an 'add my address (optional)' disclosure so ZIP -> submit is one screen.

**M39 · minor - 'Email me when a game is forming' checkbox renders as a lone centered checkbox floating above centered text**
- Why it hurts: The row looks broken, is styled inconsistently with the other three checkboxes on the page, and the detached ~20px checkbox is a poor tap target.
- Evidence: crop-emailopt-375.png (from 19-account-full.png; same at 320): checkbox centered on its own line, label text centered below - unlike the left-aligned rows in message settings; cause: globals.css:651 (.reg-form label flex-direction:column, specificity 0-1-1) beats globals.css:830-834 (.donate-opt row layout, 0-1-0) because this checkbox sits inside .reg-form (app/(app)/account/page.tsx:150-153)
- Direction: Raise .donate-opt specificity (.reg-form label.donate-opt) or move the checkbox out of .reg-form like the message-settings ones.

### Touch is an afterthought to the cursor

**M7 · major - Touch targets under 44px on nearly every primary control**
- Why it hurts: Closing modals, switching to chat, sending a message, RSVPing, dismissing banners, picking email frequency, paging the gallery, and donating all require sub-Apple-HIG taps - constant mis-taps in the primary join/chat flow, and a missed modal X hits the backdrop and dismisses.
- Evidence: globals.css:304-307 (.game-close ~32px), 134-137 (.auth-close ~22px), 913-921 (.game-tab ~31-35px), 966-970 (.chat-send ~35-38px), 706-710 (.rsvp-btn ~29px), 331-335 (.seg RSVP segments ~37px), 741-750 (.donate-banner-cta/-stop ~25px), 723-727 (.unverified-resend ~25px), 97-102 (.acct-avatar 34px), 602-607 (.gallery-dot 9x9px with 10px gaps - ten of them), 635 (.card a donate CTAs as 13px inline text links, the only tappable action on the money page), 834 + .msg-freq gap:8px at :840 (~16px radios/checkboxes in ~21px rows), 167 ('change email' 13px text link), 257-261 (.map-hud-copy ~34px), 469-471 (maplibre 29px controls); visible across 12b, 13, 03, 05, 20 screenshots
- Direction: Establish a 44px min-height/width rule (padding or ::before hit-area extension) for buttons, close X's, tabs, radio/checkbox rows, and promote the donate-card CTAs to full-width buttons as part of the redesign.

**M11 · major - Chat message delete is an ~11px text link that irreversibly deletes with no confirmation**
- Why it hurts: A destructive, irreversible action sits on a far-sub-44pt target in the thread's scroll path, so a mis-tap while scrolling silently destroys the user's own message.
- Evidence: .chat-del font-size:11px, zero padding, underlined, directly under each message body (globals.css:952-956; ~15px-tall target); remove() at components/ChatPanel.tsx:143-159 fires the delete API immediately on tap - no confirm, no undo; visible in 13-game-modal-chat-empty.png and 14-game-modal-chat-messages.png
- Direction: Move delete behind a long-press or overflow affordance with a confirm step, and give it destructive-action target sizing (24px+ minimum hit area).

**M24 · minor - Chat draft text is destroyed by normal phone gestures - scrim tap and tab switch both discard it**
- Why it hurts: Tapping outside an input is the standard phone gesture for dismissing the keyboard, but here it closes the whole modal and the half-typed message is gone; peeking at the details tab to check the time does the same.
- Evidence: Scrim click closes the modal (components/GameDetailsModal.tsx:202); ChatPanel is conditionally mounted only while tab==='chat' (GameDetailsModal.tsx:439-441) while the details panel is deliberately hidden-not-unmounted to preserve state (comment at :220-221); draft lives in local state (ChatPanel.tsx:50)
- Direction: Keep ChatPanel mounted-but-hidden like the details panel, and don't close on scrim tap while the composer has text (or confirm).

**M26 · minor - The 'would play near your cursor' preview has no touch equivalent - a legend row is permanently 0 on phones**
- Why it hurts: The mechanic that previews how many neighbors would play at a candidate spot - useful input for choosing where to propose - only works with a mouse, and phone users get a dead, permanently-zero row wasting a line of the already-oversized legend, making the UI read as ported-from-desktop.
- Evidence: 10-map-initial.png and 11a-map-hud-expanded.png (legend row 'would play near your cursor 0' while 'interested player 44'); components/MapView.tsx:682 (row rendered unconditionally), :259-268 and :441-443, :489-521 (flag-courting + jersey count gated on live pointer-hover position, which touch never produces - it only fires accidentally at the stale last-touch point)
- Direction: Give touch an intentional trigger (tap-and-hold preview or 'would play near the map center') and hide the cursor-worded row on touch devices.

**M27 · minor - Long-press-to-propose fires anywhere in the map container, including over zoom buttons and through the legend**
- Why it hurts: Holding the +/- zoom button ~500ms pops the propose-a-game modal at that corner, and long-pressing the legend - including the very cue that says 'long-press the map' - proposes a spot hidden under the frosted panel.
- Evidence: components/MapView.tsx:608-635 (onTouchStart never inspects the event target), :196 (NavigationControl zoom buttons live inside the same container); globals.css:201 (.map-legend pointer-events:none passes touches through); 10-map-initial.png (legend covers roughly the top third of the 375px screen)
- Direction: Bail out of the long-press arm when the touch target is map chrome or falls within the legend's rect.

**M28 · minor - Two-finger rotate and pitch are enabled but the compass is hidden - no way to straighten the map on touch**
- Why it hurts: An accidental twist or two-finger vertical drag during pinch-zoom leaves the map rotated/tilted, with no affordance to reset north or flatten the view.
- Evidence: components/MapView.tsx:193-196 (Map constructed with default gesture handlers - touchZoomRotate rotation and touchPitch on - while NavigationControl passes showCompass:false)
- Direction: Disable rotation/pitch on touch, or show the compass control when bearing/pitch is nonzero.

**M40 · minor - No overscroll-behavior or touch-action anywhere - panel scroll chains to the page and double-taps can zoom**
- Why it hurts: Over-scrolling the bottom sheet or chat rubber-bands/pull-to-refreshes the whole app on Android Chrome, and double-tapping 'i'm in' can trigger double-tap zoom.
- Evidence: grep of app/ + components/ finds zero overscroll-behavior/touch-action; scrollable layers over the fixed map: .map-hud (globals.css:222), .mine-panel (684), .chat-thread (931), .game-card (300), .loc-results (819); rapid-tap RSVP segments have no touch-action:manipulation (globals.css:331-340)
- Direction: Add overscroll-behavior:contain to every scrollable panel, overscroll-behavior-y:none on the map page body, and touch-action:manipulation on tap-twice controls.

**M53 · polish - Instructional copy leads with mouse verbs on a touch-primary product**
- Why it hurts: Phone users are told to 'click' and offered 'right-click' as the first option for actions they can only tap or long-press, which reads as a desktop app squeezed onto a phone.
- Evidence: components/MapView.tsx:519-520 (tooltip texts 'click to see game details', 'right-click or long-press to propose here' - right-click first), :686 ('(or right-click)' in the legend propose hint); components/MapHud.tsx:51, 66, 190-191, 195 ('click its badge', 'click the game badge', 'click the proposed-site badge'); 10-map-initial.png
- Direction: Branch the verb on input modality (tap/long-press first on touch), as the legend-propose row and one FAQ answer already do.

**M62 · polish - Pinch anywhere on the play screen zooms the map, so browser page-zoom can never reach the 12px overlay text**
- Why it hurts: Standard full-screen-map behavior, but low-vision users have no in-page way to magnify the small legend and HUD text that only exists as overlays on the map.
- Evidence: maplibre-gl.css sets touch-action:none on the interactive canvas container, and the map fills the screen (app/(app)/play/page.tsx:49-53); globals.css:208 (legend drops to 12px at <=560px); 10-map-initial.png
- Direction: Treat overlay text sizes as non-zoomable in the redesign (bump minimums) rather than relying on browser zoom.

### No coherent icon language

**M22 · minor - No coherent icon language - four art styles plus text glyphs and emoji across the core screens**
- Why it hurts: The three map badges - the app's primary vocabulary - don't read as one family, so 'existing game' vs 'proposed site' vs 'you' must be learned from legend text instead of recognized, and there is no icon set to extend into the planned bottom bar / collapsible panels.
- Evidence: components/Ball.tsx:1-11 (flat vector logo), public/you-badge.png (textured cartoon), public/game-badge.png (bold black-outline sticker), public/proposed-badge.png (soft pastel flat, no outlines), components/MapView.tsx:137-159 (thin-line SVG streamer/crosshair), close buttons as text 'x' (AuthModal.tsx:51, GameDetailsModal.tsx:210), carets as text glyphs (MapHud.tsx:225,253), emoji banner icon (DonationReminderBanner.tsx:17), plus MapLibre's stock white +/- and (i); visible in 10-map-initial.png, 12b, 21-320-map.png
- Direction: Define one icon set (single stroke weight, palette, corner language), redraw the three map badges as siblings, and replace text glyphs and emoji with icons from the same set.

**M36 · minor - Legend glyphs are illegible at 20px and the 'you' swatch doesn't match the marker it explains**
- Why it hurts: The legend is the key to decoding the map, and on a phone half its symbols can't be matched to what's actually drawn - including the one marker that represents the user.
- Evidence: 10-map-initial.png (the two yellow streamer rows look identical - straight vs wave differ only by a ~2px wiggle; 'proposed game site' icon is an unreadable dot); globals.css:208-209 (.legend-badge 20px, streamer SVGs 20x14); public/proposed-badge.png is 1024px art whose flag+cone occupy only the padded center; MapView.tsx:680 shows you-badge.png as a raw square while :379-386 draws it circle-clipped with a white rim on the map
- Direction: Cut legend art without interior padding, differentiate rows by state (color/badge) rather than a subtle wave, and render legend swatches with the exact treatment the map uses.

**M50 · minor - iOS home-screen icon has a fully transparent background - 'add to home screen' produces the logo on a black plate**
- Why it hurts: The app's own install pitch ends with an unpolished-looking black-square icon on the platform the audit says is becoming primary.
- Evidence: app/apple-icon.png - all four corners verified (0,0,0,0) alpha-transparent (iOS composites onto black); contrast with public/pwa/icon-512-maskable.png which correctly bakes the #0c1326 background; app/manifest.ts and components/InstallApp.tsx actively push installation
- Direction: Export apple-icon.png full-bleed on the navy brand background like the maskable variant.

**M51 · minor - Map badge assets are 1024px PNGs weighing 1.5-1.7MB each, drawn at 92px and below**
- Why it hurts: Every first map load on cellular pulls ~3.3MB of icon art alone before the badges (and the legend that explains the map) can appear.
- Evidence: public/game-badge.png 1,721,661 bytes and public/proposed-badge.png 1,564,542 bytes (both 1024x1024, verified via ls/sips), rendered at GAME_BADGE=92 / PROPOSED_BADGE=68 / 20px legend sizes (components/MapView.tsx:25-27, globals.css:209); public/football.png is another 1.6MB
- Direction: Re-export badges at ~2x display size (or as SVG once the icon set is redrawn) - should be a >95% size cut.

### The PWA is half-shipped

**M9 · major - No viewport-fit=cover or safe-area-inset handling anywhere, but the app ships as a standalone PWA**
- Why it hurts: Installed on a notched iPhone the layout runs edge-to-edge: the OS home indicator paints over the footer links and taps there fight the home gesture, the header collides with the status bar, and every stacked bottom offset (attribution, HUD peek) assumes a footer height that ignores the inset, drifting the whole bottom stack into the gesture zone.
- Evidence: app/layout.tsx exports no viewport (whole file, lines 1-77); zero env(safe-area-inset-*) occurrences repo-wide (grep verified); fixed chrome pinned to raw edges: .nav-float top:0 (globals.css:448-452), .app-foot bottom:0 (453-460), HUD sheet bottom:74px (271-274), banners top:72px (717, 732), map attribution bottom:42px; app/manifest.ts:21-26 (start_url /play, display standalone); 10-map-initial.png shows footer links flush against the bottom edge
- Direction: Add a viewport export with viewport-fit=cover plus env(safe-area-inset-*) padding on fixed header/footer/HUD/banners and derive the bottom-stack offsets from them - a natural part of the collapsible top/bottom panel redesign.

**M48 · minor - Install panel pops in after hydration, shoving splash content down mid-read**
- Why it hurts: A phone user who starts scrolling within the first second sees the page jump under their finger, and the install ask lands ahead of 'how it works' - before the product has been explained.
- Evidence: components/InstallApp.tsx:23-37, 61-64 (renders null on the server and appears only after a client useEffect sets ios/deferred, inserting a ~230pt card between the hero CTA and 'how it works' - crop of 02-splash-full.png ~y2300-3300; app/(marketing)/page.tsx:21, globals.css:1010-1015)
- Direction: Reserve the pane's space (or slot it after 'how it works' on mobile) so its appearance doesn't reflow the page.

**M49 · minor - Install offer, and the service worker that enables it, exist only on the marketing splash**
- Why it hurts: Signed-in phone users live at /play and email deep-links land on /rsvp//interested, so the people most worth converting to the home-screen app never see the install panel - and Chrome's beforeinstallprompt can't fire on those pages because the SW is never registered there.
- Evidence: InstallApp is rendered solely in app/(marketing)/page.tsx:21, and sw.js is registered only inside its effect (components/InstallApp.tsx:49-54)
- Direction: Register the SW app-wide and surface a dismissible install affordance from the map/account, not just the splash.

**M59 · polish - iOS install instructions say 'Safari's toolbar' for every iOS browser**
- Why it hurts: A Chrome-on-iPhone user gets step-by-step instructions naming a toolbar they don't have - their own browser's share menu has Add to Home Screen - and may conclude the feature doesn't apply to them.
- Evidence: components/InstallApp.tsx:33-37 (the isIos check /iPad|iPhone|iPod/ plus the iPadOS touch check also matches CriOS/FxiOS/Edge), :93 (renders 'tap the share button in Safari's toolbar' to all of them); the :34 comment ('Chrome on iOS... can't install either') is stale since iOS 16.4
- Direction: Word the steps browser-neutrally ('the share button in your browser').

**M60 · polish - Manifest theme/background colors don't match the app chrome, and no theme-color meta is emitted**
- Why it hurts: The Android install splash and standalone status bar render navy over a green-black app (a visible off-brand band at launch), and in-browser tabs get no toolbar theming at all.
- Evidence: app/manifest.ts:24-25 (navy #0c1326) vs globals.css:34 (body background #0b1210) and :451 (.nav-float #0b1210); no themeColor/viewport export in app/layout.tsx
- Direction: Pick one chrome color and use it in the manifest plus a viewport themeColor export, together with the iconography pass.

**M61 · polish - Manifest locks the installed Android app to portrait while the browser app supports landscape**
- Why it hurts: Installed Android users can never rotate the map even though the same app handles landscape in the browser - an inconsistency the collapsible-panel redesign should settle one way or the other.
- Evidence: app/manifest.ts:26 (orientation: portrait-primary); the audit set includes 26-landscape-map.png showing the map is expected to work rotated in-browser
- Direction: Drop the orientation lock or make portrait-only an explicit, documented design decision.

**M63 · polish - body background-attachment:fixed is unsupported on iOS Safari**
- Why it hurts: iOS treats fixed attachment as scroll and sizes cover against the full document, so on long pages the backdrop renders oversized/blurry and can repaint jankily.
- Evidence: globals.css:35-41 (map-bg.png with background-attachment: fixed, fixed and cover); affects scrolling content pages seen in 04-register-full.png, 19-account-full.png
- Direction: Move the background onto a position:fixed pseudo-element/layer (the #bg canvas pattern already used) instead of background-attachment.

### Accessibility gaps, one fatal

**M1 · BLOCKER - Game/proposed badges are canvas-only: no screen-reader or keyboard path to find or join a game**
- Why it hurts: VoiceOver/TalkBack and switch-access users cannot reach game details at all - the core find-and-join flow is completely inaccessible to them, with no alternative path anywhere in the app.
- Evidence: components/MapView.tsx:204 (comment: badges are drawn on a canvas so they can't be selected), :552-590 (nearestCluster pixel hit-test on map click is the only way to reach GameDetailsModal), :678 (overlay canvas is pointer-events:none with no DOM/ARIA equivalents); 10-map-initial.png (badges are the sole entry point; HUD copy says 'click its badge on the map to join')
- Direction: Render a focusable, labelled DOM twin per badge (absolutely positioned button synced to the map projection) or add an equivalent 'games near you' list outside the canvas.

**M42 · minor - All type is px and control heights are px-locked - OS text-size settings do nothing on iOS and clip at 200% Android font scale**
- Why it hurts: Low-vision users who bump their phone's text size get either no change at all (iOS Dynamic Type) or clipped button/input labels and a header that overlaps the legend (Android font scaling).
- Evidence: globals.css:28 (body font-size 16px; every font-size in the file is px, no rem anywhere), :157 and :162 (44/46px fixed-height inputs/buttons), :347 and :351 (34px inputs/buttons), chat textarea height 64px (~:964), :432 (.app-body padding-top:64px) with the legend pinned at top:58-64px assuming the header never grows
- Direction: Move type to rem with min-height instead of height on controls, and derive the header offset from a shared variable.

**M43 · minor - Small faint text and green legend counts fall below AA contrast - including the legal consent copy**
- Why it hurts: On a phone outdoors the timestamps, legend tallies, and the legally load-bearing consent text are the smallest, dimmest text in the app - guesswork for anyone without perfect vision.
- Evidence: globals.css:16 (--faint #6f7891, ~3.7:1 over the frosted game card, ~4.3:1 against the #0c1326 surface - below 4.5:1 for small text), used at 11-12px in :314 (dt labels), :950 (.chat-when), :952 (.chat-del), .chat-who, and :793 (.reg-hint 12px - the 18+/liability/assumption-of-risk consent paragraphs, rendered twice on the register form); :206 (.legend-n in --grass-l #5b9452 over a 55%-alpha panel drops under 3:1 when bright map green shows through); 10-map-initial.png, 14-game-modal-chat-messages.png, 04-register-full.png
- Direction: Lighten --faint and the legend-count green a step (or raise panel alpha behind them), bump the legal text to 13px+ in --muted, and state the consent line once.

**M44 · minor - Modal focus trap counts inert/hidden controls - Tab sticks in the destructive-confirm dialog and Shift+Tab escapes the modal**
- Why it hurts: With the retire/pause confirm open, 'first' is the inert close button, so Tab from the last button no-ops and Shift+Tab walks out into the obscured map/header - keyboard and switch users get lost mid destructive action; the same hole leaks focus out of the chat tab for read-only viewers.
- Evidence: lib/useFocusTrap.ts:15-27 (SEL doesn't exclude [inert]/[hidden]; wrap logic fires only when activeElement === first/last); components/GameDetailsModal.tsx:209 (card goes inert while confirmReq is open), :222-223 (details tabpanel hidden, not unmounted), :448-519 (confirm dialog last in DOM)
- Direction: Filter focusables to visible, non-inert elements (el.closest('[inert]'), offsetParent/hidden checks) in useFocusTrap.

**M56 · polish - Chat thread is not a live region - screen readers hear nothing when messages arrive**
- Why it hurts: Screen-reader users get no announcement when messages arrive while the panel is open, even though the panel polls and appends them.
- Evidence: components/ChatPanel.tsx:177 (plain div, no role=log/aria-live); 14-game-modal-chat-messages.png
- Direction: Add role=log / aria-live=polite to the thread container.

### Chat doesn't fit the phone it will mostly be used on

**M23 · minor - Chat shows only 2-3 messages: fixed 264px thread plus a permanent 3-line who-can-read preamble, with janky nested scrolling**
- Why it hurts: On a tall phone most of the modal is chrome while the conversation gets a fixed 264px window, making catching up on a pre-game thread tedious.
- Evidence: 13-game-modal-chat-empty.png and 14-game-modal-chat-messages.png (2-3 messages visible on an 812pt phone; in 14 the first visible message's author/timestamp header is clipped so it reads as anonymous); .chat-thread max-height:264px never grows with viewport (globals.css:929-934); .chat-who preamble (globals.css:923-926, ChatPanel.tsx:166-169) takes 3 lines at 375px, 4 at 320px, always visible; no overscroll-behavior anywhere so thread-in-card scrolling chains
- Direction: Collapse the preamble to one line with an info toggle and let the thread flex to fill available height.

**M25 · minor - Chat auto-scroll yanks the reader to the bottom whenever the poll delivers a new message**
- Why it hurts: A user who scrolled up to reread parking details gets jumped to the newest message mid-read every time anyone posts - in an active pre-game chat that means losing your place repeatedly.
- Evidence: components/ChatPanel.tsx:112-115 sets el.scrollTop = el.scrollHeight on every msgs.length change with no near-bottom check; the 7s poll (ChatPanel.tsx:14) appends messages while the panel is open
- Direction: Only auto-scroll when the user is already near the bottom; otherwise show a 'new messages' jump chip.

**M55 · polish - Chat timestamps freeze between polls and there is no delivery feedback for the 7s cadence**
- Why it hurts: A message can read 'now' for many minutes, and incoming replies appear up to 7s late with no indication the panel is live, which reads as staleness rather than a deliberate tradeoff.
- Evidence: ago() computed at render only (components/ChatPanel.tsx:34-40); polls that return no changes set identical state so React skips re-render, leaving 'now' on screen indefinitely; POLL_MS=7000 at ChatPanel.tsx:14 (a documented Cloud Run cost tradeoff; own sends round-trip immediately via the post-send poll at :135)
- Direction: Re-render timestamps on a timer; the 7s poll itself is a reasonable tradeoff to keep.

### The splash undersells on the device that matters

**M18 · minor - Donate cards render 2-up at 375px: fragmented 3-words-per-line columns plus an orphaned half-width card**
- Why it hurts: The project's only revenue page looks broken on the primary device: the flagship card is a skinny tower of fragmented text and the layout ends in an awkward hole.
- Evidence: 05-donate-full.png and crop-05-cards.png ($3/month SUGGESTED card wraps into ~12 short lines; 'just show up' sits alone at half width next to a dead column); globals.css:560 (.cards { grid-template-columns: repeat(auto-fit, minmax(160px, 1fr)) } - two 160px columns fit in the 335px content width)
- Direction: Stack the donate cards full-width below ~560px (raise the minmax floor or add a mobile breakpoint).

**M19 · major - 'See it in action' gallery renders screenshots too small to read on a phone**
- Why it hurts: This is the only product preview a logged-out phone visitor gets, and it communicates nothing - every slide is an unreadable thumbnail with a pill covering what little is visible.
- Evidence: 02-splash-full.png (~y5150-6350) and 25-320-splash-full.png: the signup slide contains down to a ~139pt-wide strip inside a 335x210pt stage with all in-image text illegible; globals.css:569-581 (.gallery-stage aspect-ratio 1120/704, .gallery-shot object-fit:contain) against source images up to 1718x1056 and portrait shots like signup.jpg (725x1091); the .gallery-label pill (globals.css:582-587) overlays the middle-bottom of the already-tiny image
- Direction: Serve phone-cropped/portrait screenshots (or a portrait stage at phone width) and move the title label off the image.

**M20 · major - Hero copy wall pushes the splash's only CTA to or below the first-screen fold**
- Why it hurts: The splash's one job is getting a visitor to tap that button, and on most real phone viewports they must read ~120 words and scroll before they even see it.
- Evidence: 01-splash-top.png (kicker + acronym + 3-line h1 + two lead paragraphs, the second 55 words, put 'show interest near you' at ~y600-643pt on a 375x812 zero-chrome viewport - real Safari/in-app-browser chrome cuts it off on load); 25-320-splash-full.png (CTA ~810pt down); app/(marketing)/page.tsx:13-16 (hero.body + hero.body2 from config/skins/flag-football.json), globals.css:473-477 (.hero padding 92px 20px 80px)
- Direction: Tighten hero copy on mobile (or move body2 below the CTA) so the button lands solidly above the fold.

**M47 · minor - Gallery carousel cannot be swiped - 10 slides are paged only by arrow taps**
- Why it hurts: Swipe is the default carousel gesture on a phone; users who try it get nothing and are unlikely to tap an arrow 9 times to see the rest.
- Evidence: app/(marketing)/Gallery.tsx:22-46 (only onClick handlers on prev/next buttons and dots; no touch/pointer/swipe handling anywhere); 02-splash-full.png (10-dot indicator row; config/skins/flag-football.json gallery has 10 entries)
- Direction: Add touch/pointer swipe support or convert to a native horizontal scroll-snap strip.

**M57 · polish - Marketing-page section padding leaks into account sections, adding ~250px of dead space**
- Why it hurts: Roughly 250px of unintended scroll on an already long single-column page, with headers floating detached from their content.
- Evidence: 19-account-full.png and 24-320-account-full.png (~90-120px blank gaps between 'manage in my games' -> 'location' and 'privacy.' -> 'message settings'); globals.css:548 (global section { padding: 48px 0 8px } applies to the <section className="account-col"> elements at app/(app)/account/page.tsx:83/114/164/195, on top of the 28px stacked-grid gap at globals.css:851)
- Direction: Zero out the inherited section padding inside .account-grid (.account-col { padding: 0 }).

**M58 · polish - Gallery dots/caption row jumps vertically while paging slides**
- Why it hurts: Paging from a short-caption slide to a long-caption one shifts the dot row ~22px, moving the controls under the user's thumb.
- Evidence: globals.css:597-600 (.gallery-caption reserves min-height:2.5em ~2 lines) but captions run up to 89 chars (config/skins/flag-football.json, e.g. game-on-email), wrapping to 3 lines at 320-375pt widths; 2-line captions visible in 02-splash-full.png
- Direction: Reserve 3 lines (min-height:3.75em) or clamp captions.

### Small stuff that reads as unfinished

**M46 · polish - Google sign-in dies silently when GSI rejects the origin**
- Why it hurts: Dev-config noise in this sweep, but the failure mode is user-facing: a rendered Google button that does nothing when tapped, with no message - the same misconfig in prod would kill mobile Google login invisibly.
- Evidence: console-errors.txt lines 1-6 (3x pair of a 403 + '[GSI_LOGGER]: The given origin is not allowed for the given client ID' - the OAuth client lacks http://localhost:3000 as an authorized JS origin); components/GoogleButton.tsx:60-64 (the 'isn't configured' fallback only covers a missing clientId or script-load failure, never origin rejection)
- Direction: Verify prod/dev origins are registered on the OAuth client, and surface a fallback note when the GSI iframe fails to become interactive.

**M64 · polish - No show-password toggle on the auth modal or register form**
- Why it hurts: Typing blind on a phone keyboard is the top source of failed logins and mistyped signup passwords.
- Evidence: 03-auth-modal.png, 04-register-full.png (plain password fields); components/AuthModal.tsx:71-74 and components/RegisterInterestForm.tsx:85-88 (type=password with no reveal control)
- Direction: Add an eye toggle inside the password inputs.

## Corrections made during verification

Honest audits kill their own findings. These were raised and then struck or reframed:

- **Stranded hover tooltip "bug"** - refuted: the automated mouse left a tooltip on screen in a way real touch input cannot; pointer events guarantee pointerout on touch. (The *cursor-only feature* itself is still M26.)
- **"Your message vanishes after send"** - reframed: `send()` polls immediately, so the gap is network latency with no optimistic append or sending state, folded into M55, not a lost-message bug.
- **"First chat message has no author header"** - reframed: every message renders a header; the top message's header was clipped by the auto-scrolled fixed-height thread. Folded into M23.
- **Three duplicate chat messages in the sweep DB** - test-harness artifact (a Playwright actionability race re-sent the message), not an app dedup bug.

## What this audit did NOT cover (checkable follow-ups)

- **Email-token landing pages were never captured: /rsvp, /interested, /decline, /unsubscribe, /verify-email (app/(marketing)/rsvp/page.tsx, interested/page.tsx, decline/page.tsx, unsubscribe/page.tsx, verify-email/page.tsx). Each has a confirm-button GET state plus done/expired/invalid variants (rsvp alone has in/out/cancelled/closed/invalid). Check all states at 375 and 320.** - These pages are opened almost exclusively from phone mail clients - they ARE the mobile product for anyone off the map. The verify-email page even documents that people 'click straight from the inbox, often on a different device.' They use the marketing layout with the fixed legal footer (M32's overlay) and untested .prose/button sizing, and a broken tap here silently loses an RSVP.
- **The password-reset flow: /forgot-password and /reset-password (ForgotForm.tsx, ResetForm.tsx), including the sent-email confirmation state, the expired-token state, and the reset form with the keyboard up.** - It's an email-driven flow started and finished on a phone, and its inputs are subject to the same audit-wide problems (sub-16px zoom M6, sub-44px targets M7, no show-password M64) but were never verified. A user locked out on mobile has no fallback path.
- **The unverified-email state end to end: UnverifiedBanner renders from app/(app)/layout.tsx for every signed-in-but-unconfirmed user, and can stack with DonationReminderBanner (M10 counted only the donate banner). Also the gating UX - what an unverified user sees when they tap join or propose (they're blocked until confirmed), and the resend button's sent/error states.** - Every new signup passes through this state on their first mobile session. Two fixed banners plus header plus legend compounds the M3/M10 chrome problem beyond what was measured, and if the join-block feedback is invisible on a phone, new users conclude the app is broken at the exact moment they're most likely to churn.
- **The donate money path on a phone: Stripe hosted checkout itself, the success return to /account?donated=1 (does any confirmation actually show?), the cancel return to /donate, and the billing-portal round trip for managing a subscription (app/(marketing)/donate/actions.ts). Also that signed-out /donate redirects to /?signin=1&next=/donate - a redirect chain through the auth modal on mobile.** - This is the only revenue flow and it round-trips through an external site on mobile Safari, which is where redirects, back-gestures, and lost session state break things. The audit stopped at the donate page's layout (M18) without ever tapping through the transaction.
- **A real installed-PWA session on device: launch from home screen with no network (public/sw.js deliberately caches nothing, so offline launch shows a raw browser error), iOS cookie isolation (standalone PWAs get separate storage from Safari, so the freshly installed app may open logged out), and email links opening in the browser instead of the installed app - splitting the user across two logged-in contexts.** - The audit found installed-PWA dead ends (M2, M49) from the browser, but never ran the installed app itself. 'Install it, kill wifi, launch' and 'install it, then tap an RSVP email link' are five-minute device checks that expose whether install makes the experience worse, not better.
- **Offline/slow-network behavior beyond the one silent map-fetch failure (M45): tiles.openfreemap.org unreachable leaves a blank basemap with flags floating on nothing; chat message SEND failure feedback on flaky signal (ChatPanel treats dropped polls as fine, but what does a failed send show?); server-action form submits (register, propose, RSVP confirm) on slow 3G - pending state, double-tap double-submit, and error surfacing.** - This product is used standing on the edge of a park on cellular. Every network-failure state in the app is currently either untested or known-silent, and a swallowed propose or RSVP submit is data loss the user never learns about.
- **Cellular first-load weight of the splash: public/map-bg.png is 2.3MB and football.png 1.6MB, on top of the 1.5-1.7MB badges (M51 counted only the map badges). Measure marketing-page transfer size and LCP on throttled 4G.** - The splash is the landing page for every shared link and it currently ships roughly 5MB of decoration. On cellular that's a many-second blank-or-partial first paint for exactly the first-time phone visitors the page exists to convert.
- **Form validation and server-error states across every mobile form: wrong password in the auth modal, duplicate-email and bad-ZIP on register, propose rejection, account save failure. Where does the error text render, is it visible above the keyboard and inside the scrolled viewport, and does the scroll position jump on rerender?** - The audit captured every form only in its blank happy state (the sole error finding, M46, is a silent one). On a phone the error message is routinely off-screen behind the keyboard or above the fold - a form that fails invisibly reads as frozen and gets abandoned.
- **The long-press propose gesture end to end on real iOS and Android: no -webkit-touch-callout or user-select suppression exists anywhere in the CSS, so a 500ms press over legend/HUD text (which M27 says the gesture fires through) can trigger the iOS selection loupe or Android text-select simultaneously with proposing; also whether the pin lands at the finger, and press-cancel when the finger drifts into a pan.** - M27 measured only the hit region from code. The gesture is the app's core creation action and OS-level long-press behaviors are invisible to automation - only a device run shows whether proposing a site fights the platform's own gestures.
- **Real keyboard interaction on device for every input surface: nothing in the codebase touches visualViewport, so chat-composer occlusion (M5) and auth-modal occlusion (M29) were inferred from layout math. Verify on-device: focus scroll-into-view, the iOS accessory bar, layout after keyboard dismiss (iOS often leaves the page scrolled), and landscape-with-keyboard where ~100px of app remains.** - Keyboard-viewport behavior is the classic gap between emulated and real mobile - fixes for M5/M29 will be built and 'verified' in an emulator that doesn't squish the viewport, then still fail on actual phones.
- **Game lifecycle and captain states of the game modal and my-games: captain tools (min-players editor, retire flow from captain-actions.ts / retireEligibility), roster-full state, paused/frozen game states (lib/mime/freeze.ts, gating.ts), the join-confirm step (lib/email/joinConfirm.ts), leaving a game, and the weekly occurrence in/out toggle in my-games (occurrence.feature covers it in e2e).** - The audit captured the game modal only as details + chat. Captains run their games from phones at the field; if the retire button, min-players stepper, or weekly in/out toggle has the same sub-44px/overflow problems as everything else, the audit's fix list under-scopes the modal rework.
- **Empty and first-run states: a brand-new area map with zero flags of any kind (is there any 'nothing near you yet - propose a spot' guidance, or just empty map?), my-games with no games, and account's OptedOutAreas both empty and populated.** - A cold-start city is the most common real state for a growth-stage product - every invited friend outside the seeded area lands on a blank map. Automation captured seeded-data screens only, so the audit says nothing about whether the empty map reads as 'be the first' or 'this app is dead.'
- **Account sub-flows never opened: the ChangeEmail two-step (components/ChangeEmail.tsx - new-address form, pending-verification state), and the InviteFriend modal launched from AccountMenu (components/InviteFriend.tsx). Also note the invite/share path uses only email + clipboard copy - no navigator.share / Web Share API on a touch-primary product.** - These are modals-within-the-account-page with their own inputs and focus behavior, inheriting every modal problem (M29, M44, M54) unverified. Invite is the growth loop; on a phone the native share sheet (SMS, WhatsApp) is how people actually invite, and its absence is a checkable product gap the audit never saw.
- **The notification emails themselves as mobile surfaces: lib/email/templates.ts renders proposal alerts, weekly polls, join confirmations, and the donation footer that get opened in phone mail clients - button tap sizes, layout width at 375px, dark-mode mail rendering, and whether links are thumb-sized.** - Email is this app's only push channel (M12 killed the in-app one), so the weekly poll email IS the mobile UI for retained users. An audit of every screen except the one users see most often has a hole in it, and mail-client rendering is its own compatibility minefield.
- **Error and 404 pages at mobile widths: app/not-found.tsx, app/error.tsx, app/global-error.tsx, app/(app)/error.tsx, and app/(app)/show-interest/error.tsx (notFound.feature exists in e2e, so the state is reachable).** - Broken/stale email links (expired tokens, retired games) funnel phone users to exactly these pages. If they lack the app nav (M2) they're literal dead ends at the worst possible moment, and nobody has ever looked at them on a phone.
- **In-app browser webviews as a category: opening the site from Gmail, Instagram, or Messenger's embedded browser, where Google GSI is blocked outright (compounding M46's silent death), beforeinstallprompt never fires, and viewport chrome differs. Checkable by sharing the link to yourself in each app.** - A pickup-sports app spreads through group chats and social posts, so the webview is many users' true first render. Google sign-in silently dying there turns the recommended auth path into a dead end for the highest-intent traffic source, and no confirmed finding covers it.
- **Android system-level gesture conflicts: does the hardware/gesture back button close an open modal (game modal, propose, auth) or navigate away and lose state - no history/popstate handling appears in the modal components; and does Chrome's pull-to-refresh fire during downward map pans (related to but distinct from M40's overscroll finding).** - Back is THE dismiss gesture on Android; a modal that survives it by dumping you off the page (destroying a propose form or chat draft, compounding M24) makes the app feel broken to half the phone market. Automation on iOS-sized viewports never exercises it.
- **Landscape for everything that isn't the map: the audit's only landscape capture was the map screen (M4). Game modal with chat, propose form, auth modal, and register in landscape phone orientation (~375px of height, less with keyboard) were never captured.** - The manifest locks installed Android to portrait (M61) but the browser app rotates freely, and vh-capped modals (M41) at 375px height with a keyboard leave essentially zero usable form area - a distinct failure mode from anything in the portrait findings.
- **Motion and vestibular accessibility: prefers-reduced-motion is honored only by FlagFieldCanvas.tsx - the map's flyTo/easeTo camera animations, the gallery carousel, and the install-panel/banner pop-ins (M48) ignore it. Also no full VoiceOver/TalkBack device pass of a complete join flow, beyond the static a11y findings (M1, M56).** - Full-screen map camera animation is a top vestibular trigger and the setting is a one-line media query to respect. And the screen-reader findings were code-derived; only a real TalkBack/VoiceOver run shows whether a blind user can get from map to joined game at all.

## Reproducing the sweep

The sweep script lives in the session scratchpad (`mobile-audit/sweep.ts`); it logs in as a seeded member, drives every screen at phone widths, and saves PNGs. Rebuild with `NEXT_PUBLIC_E2E=1` for the map seam, `scripts/deploy_app.sh --seed`, mint the login with `scripts/make-test-member.ts`. Re-run it after each redesign phase - the screenshots are the before/after record.
