import type { AreaScenario } from "./mime/areaScenario";

export type ShareTemplate = { label: string; text: string };

/** Copy-paste post text, per scenario — never auto-posted, just handed to the
 *  user to paste wherever (a group chat, a subreddit, a story caption). Two
 *  flavors: a short one that fits a tweet/text, and a longer caption-style one. */
export function buildShareTemplates(
  scenario: AreaScenario, place: { city: string | null; zip: string | null } | null, url: string,
): ShareTemplate[] {
  const where = place?.city ? `${place.city}${place.zip ? ` ${place.zip}` : ""}` : "my area";

  switch (scenario.kind) {
    case "alone":
      return [
        { label: "short", text: `Trying to get a pickup flag football game going in ${where} — right now it's just me. If you're in, join me: ${url}` },
        { label: "caption", text: `Starting a flag football crew in ${where} 🏈\n\nNo game yet — just me so far. If enough of us sign up, it becomes a real weekly game, no organizing required. Takes 30 seconds: ${url}` },
      ];
    case "ambient-interest":
      return [
        { label: "short", text: `${scenario.totalCount} of us are interested in a flag football game in ${where}. Know a good field/time? Propose it — or just add your name: ${url}` },
        { label: "caption", text: `${scenario.totalCount} people (including me) want a flag football game in ${where} 🏈\n\nNobody's proposed a spot yet — if you're one more, we're that much closer. ${url}` },
      ];
    case "open-proposal":
      return [
        { label: "short", text: `A flag football game's been proposed in ${where} — ${scenario.interestedCount}/${scenario.pMin} people are in. Tap in before it closes: ${url}` },
        { label: "caption", text: `There's a flag football game on the table in ${where} 🏈\n\n${scenario.interestedCount} of the ${scenario.pMin} we need are already in — help us get there: ${url}` },
      ];
    case "games":
      return [
        { label: "short", text: `There's a standing flag football game in ${where}${scenario.placeText ? ` at ${scenario.placeText}` : ""} — come play: ${url}` },
        { label: "caption", text: `Weekly pickup flag football is a real thing in ${where} now 🏈 come fill out the roster: ${url}` },
      ];
  }
}
