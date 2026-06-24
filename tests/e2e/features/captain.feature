Feature: Captain controls

  Scenario: a captain pauses and resumes the series
    Given an established weekly game near me
    And I captain it as "Cap Tain" with email "cap@example.com" in ZIP "78701"
    When I open the game on the map
    And I pause the series
    Then the game shows as paused
    When I resume the series
    Then the game is running again

  Scenario: a captain retires the series for good
    Given an established weekly game near me
    And I captain it as "Cap Tain" with email "cap@example.com" in ZIP "78701"
    When I open the game on the map
    And I retire the series
    Then the game is gone

  Scenario: a captain calls off this week
    Given an established weekly game near me
    And I captain it as "Cap Tain" with email "cap@example.com" in ZIP "78701"
    When I open the game on the map
    And I cancel this week
    Then next week becomes the next game

  Scenario: a captain steps down
    Given an established weekly game near me
    And I captain it as "Cap Tain" with email "cap@example.com" in ZIP "78701"
    When I open the game on the map
    And I step down as captain
    Then I can volunteer as captain

  Scenario: a player volunteers to captain a game that has no captain
    Given an established weekly game near me
    And I am a confirmed player "Reg Ular" with email "reg@example.com" in ZIP "78701"
    When I open the game on the map
    Then the game shows it has no captain
    When I volunteer as captain
    Then I have captain controls
