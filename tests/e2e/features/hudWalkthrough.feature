Feature: HUD walkthrough — one area's life story, every scenario in order

  A single player's area, walked through every distinct HUD state in the order
  an area actually grows: first one here → neighbors show real interest → those
  neighbors back a proposal → it fills and the game is on, rostered with them →
  a second game joins it. One login, one continuous cohort: the interest that
  accumulates is what actually forms the games — no ghost games with nobody
  behind them. The report captures only the HUD at each beat.

  @mobile
  Scenario: an area grows from one player to two real weekly games
    Given the report captures only the HUD
    And I am a confirmed player "Journey Jo" with email "jo@example.com" in ZIP "30301"
    When I open the map
    Then the HUD tells me I'm the first one here
    And the HUD's FAQ explains how a game forms, with the live threshold
    And the HUD offers a copyable share post

    When 6 neighbors show real interest in my own area
    Then the HUD tells me 7 people are interested near me
    And the HUD offers a copyable share post

    When those neighbors back a proposal at "Grant Park"
    Then the HUD tells me a game's been proposed at "Grant Park" with 6 of 6 in

    When the proposal fills and the game is on
    Then the HUD tells me there's a game near me
    And that game is backed by a real 6-player roster

    When those neighbors form a second game at "Piedmont Park"
    Then the HUD tells me there are 2 games near me
    And both games are backed by real rosters
