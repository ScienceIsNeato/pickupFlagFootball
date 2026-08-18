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

  Scenario: players talk in a game's chat
    Given an established weekly game near me
    And I am a confirmed player "Chat Cher" with email "chatter@example.com" in ZIP "78701"
    When I open the game on the map
    And I open the chat tab
    And I post "east lot, gate code 1234" in the chat
    Then the chat shows "east lot, gate code 1234"
    When I delete my chat message
    Then the chat no longer shows "east lot, gate code 1234"

  Scenario: someone else's message lights the unread dot
    Given an established weekly game near me
    And I am a confirmed player "Dot Reader" with email "dotreader@example.com" in ZIP "78701"
    And another player posted in that game's chat
    When I open the map
    Then I see the chat unread dot
    When I open the game on the map
    And I open the chat tab
    And I reload the map
    Then the chat unread dot is gone
