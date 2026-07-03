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
