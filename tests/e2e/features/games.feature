Feature: Finding & joining a game

  @mobile
  Scenario: a player joins a weekly game from the map
    Given an established weekly game near me
    And I am a confirmed player "Reg Ular" with email "joiner@example.com" in ZIP "78701"
    When I open the game on the map
    And I join the weekly game
    Then the game shows in my games

  Scenario: a game outside my travel radius can't be joined
    Given an established weekly game outside my travel radius
    And I am a confirmed player "Far Away" with email "faraway@example.com" in ZIP "78701"
    Then opening the game tells me it's outside my travel radius
