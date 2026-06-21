Feature: Finding & joining a game

  Scenario: a confirmed player joins a weekly game
    Given an established weekly game near me
    And I am a confirmed player "Reg Ular" with email "joiner@example.com" in ZIP "78701"
    When I open the game on the map
    And I join the weekly game
    Then I am on the game's roster
    And the game shows in my games

  Scenario: a game outside my travel radius can't be joined
    Given an established weekly game outside my travel radius
    And I am a confirmed player "Far Away" with email "faraway@example.com" in ZIP "78701"
    When I open the game on the map
    Then I am told the game is outside my travel radius
