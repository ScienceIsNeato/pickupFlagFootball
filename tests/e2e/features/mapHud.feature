Feature: Map scenario HUD

  Scenario: a brand-new area shows the "you're first" HUD with share templates
    Given I am a confirmed player "Lonely Lou" with email "lou@example.com" in ZIP "90001"
    When I open the map
    Then the HUD tells me I'm the first one here
    And the HUD offers a copyable share post

  Scenario: an area with a standing game points you at it
    Given I am a confirmed player "Gamer Gwen" with email "gwen@example.com" in ZIP "78701"
    And a standing game is added to my own area
    When I open the map
    Then the HUD tells me there's a game near me

  Scenario: ambient interest with no proposal yet nudges you to propose or share
    Given I am a confirmed player "Nearby Nora" with email "nora@example.com" in ZIP "10001"
    And 3 other neighbors are interested in my own area
    When I open the map
    Then the HUD tells me how many are interested near me
    And the HUD offers a copyable share post

  Scenario: an open proposal shows the live tally and a way to join in
    Given I am a confirmed player "Proposal Pete" with email "pete@example.com" in ZIP "60601"
    And an open proposal with 2 interested is added to my own area
    When I open the map
    Then the HUD tells me a game's been proposed with a live tally

  Scenario: the HUD reflects a change in its own area right away, not after a 15s wait
    Given I am a confirmed player "Fresh Fiona" with email "fiona@example.com" in ZIP "94102"
    And an open proposal with 2 interested is added to my own area
    When I open the map
    Then the HUD tells me a game's been proposed with a live tally
    When one more neighbor joins the open proposal in my own area
    And the map tells the HUD its area changed
    Then the HUD's tally updates to reflect it, without a page reload
