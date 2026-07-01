Feature: A weekly game runs (occurrence FSM)

  Scenario: the poll fills — the week is on, then played
    Given a weekly game whose poll just closed with enough players in
    And I am a confirmed player "Wendy Week" with email "wendy@example.com" in ZIP "78701"
    And I'm a regular in this game
    When I open the game on the map
    Then I've found my weekly game
    When the engine ticks
    Then the week is on
    And the game-on email lists who's coming
    When game day passes and the engine ticks
    Then the week is played

  Scenario: the poll comes up short — the week is skipped
    Given a weekly game whose poll just closed with too few players in
    And I am a confirmed player "Sam Skip" with email "sam@example.com" in ZIP "78701"
    And I'm a regular in this game
    When I open the game on the map
    Then I've found my weekly game
    When the engine ticks
    Then the week is skipped
    And the off-week email has no donation ask

  Scenario: a supporter is thanked, not asked, on the game-on email
    Given a weekly game whose poll just closed with enough players in
    And I am a confirmed player "Sue Porter" with email "sue@example.com" in ZIP "78701"
    And I'm a supporter in this game
    When the engine ticks
    Then my game-on email thanks me instead of asking
