Feature: HUD walkthrough — every scenario, one area's life story

  A single player's area walked through every distinct HUD state in the order
  an area actually grows: first one here → neighbors show interest → a game is
  proposed → the game is on → a second game joins it. The report captures only
  the HUD itself at each beat — this story is about the HUD, not the map.

  Scenario: the HUD narrates an area growing from one player to two games
    Given the report captures only the HUD
    And I am a confirmed player "Journey Jo" with email "jo@example.com" in ZIP "30301"
    When I open the map
    Then the HUD tells me I'm the first one here
    When 3 other neighbors are interested in my own area
    And the map tells the HUD its area changed
    Then the HUD tells me how many are interested near me
    When an open proposal with 2 interested is added to my own area
    And the map tells the HUD its area changed
    Then the HUD tells me a game's been proposed with a live tally
    When a standing game is added to my own area
    And the map tells the HUD its area changed
    Then the HUD tells me there's a game near me
    When a second standing game is added to my own area
    And the map tells the HUD its area changed
    Then the HUD tells me there are 2 games near me
