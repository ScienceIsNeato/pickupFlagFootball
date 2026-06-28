Feature: Proposing a game (the proposer's view)

  A confirmed player proposes a game at a spot — which sparks a formation, courts
  the neighbors by email, and makes the proposer its captain — and it then either
  gathers enough commitments and gets scheduled, or falls short and stalls. The
  emails the flow sends are captured into the story report at each beat.

  Scenario: a proposed game stalls when too few people commit
    Given I am a confirmed player "Polly Propose" with email "polly@example.com" in ZIP "78701"
    When I propose a game at a nearby spot
    Then I am a captain of the proposed site
    When I open the game on the map
    Then the proposed site shows
    When the suggestion window closes and the engine ticks
    Then the courting emails go out
    When too few players commit
    And the availability window closes and the engine ticks
    Then no game forms and the site stalls
    And everyone hears the formation stalled

  Scenario: a proposed game gets scheduled when enough people commit
    Given I am a confirmed player "Sam Spark" with email "sam@example.com" in ZIP "78701"
    When I propose a game at a nearby spot
    Then I am a captain of the proposed site
    When I open the game on the map
    Then the proposed site shows
    When the suggestion window closes and the engine ticks
    Then the courting emails go out
    When enough players commit to a spot
    And the availability window closes and the engine ticks
    Then a game is scheduled here
    And I get the game-on email
    And I am a captain of the scheduled game
    When I refresh the map
    And I open the game on the map
    Then I am already in the game as its captain
