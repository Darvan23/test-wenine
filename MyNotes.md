this software is meant to track every hour of internship and it is a calender and a schedule too 


next step i will add availability and hours needed for internship
I would need to build a calculator where I can put My hours how many hours i need and also my availibility and dead end and the calculator can give me the whole schedule of the stage of how many hours I need in a week and which days and when it ends like an easy sytsem where the students can know if they can get the hours they need for stage on time i need to do 1000 hours for example and I have time till end of April and that is 4 days working each day 8 hours then i get the my 1000 hours at the end of the april


Now what we have is verynice and we should keep it but for the urenorganisatie i want to be able to have two modes where you can switch between them one like what we already have one like the document i send where every thing is small and clearer
[text](<../../../Downloads/UREN - STAGAIRES - 2026.pdf>)


## Ideas / backlog (bigger features for later)

1. **Make it installable as an app (PWA)** — add a manifest.json + app icon and a small
   service worker. Students can then "Add to Home Screen" on their phone and Wenine Hours
   opens full-screen with its own icon, like a real app. No app store needed, free.

2. **"Confirmed hours" summary tile** — the school probably only counts hours the admin
   has confirmed (✓). Add a fifth tile on the hour tracker: "Bevestigd: X u" so every
   student sees how much of their total is already officially signed off.

3. **Excel/CSV export** — next to the JSON backup, an export the school/administration
   can open directly in Excel (one row per day: name, date, hours, times, confirmed).

4. **Timestamps / audit trail** — store "last changed at" on every entry and show it in
   the admin day editor, so the admin can see when something was filled in or changed.

5. **Email notifications** — mail the admin when a new request comes in. Needs Firebase
   Cloud Functions (paid Blaze plan, still ~free at our scale) — only if the badge on
   the Rooster tab turns out not to be enough.