Feature: Proposing a game (the proposer's view)

  A confirmed player proposes a game at a spot — which sparks a formation and makes
  them its captain — and it then either gathers enough commitments and gets
  scheduled, or falls short and stalls.

  Scenario: a proposed game stalls when too few people commit
    Given I am a confirmed player "Polly Propose" with email "polly@example.com" in ZIP "78701"
    When I propose a game at a nearby spot
    Then I am a captain of the proposed site
    When I open the game on the map
    Then the proposed site shows
    When the suggestion window closes and the engine ticks
    And too few players commit
    And the availability window closes and the engine ticks
    Then no game forms and the site stalls

  Scenario: a proposed game gets scheduled when enough people commit
    Given I am a confirmed player "Sam Spark" with email "sam@example.com" in ZIP "78701"
    When I propose a game at a nearby spot
    Then I am a captain of the proposed site
    When I open the game on the map
    Then the proposed site shows
    When the suggestion window closes and the engine ticks
    And enough players commit to a spot
    And the availability window closes and the engine ticks
    Then a game is scheduled here
    And I am a captain of the scheduled game
