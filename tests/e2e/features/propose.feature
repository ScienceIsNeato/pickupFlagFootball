Feature: Proposing a game (the proposer's view)

  A confirmed player proposes a game at a spot — its own independent attempt that
  emails nearby players a "want in?" with details, and makes the proposer its
  captain. It then gathers enough interest and gets scheduled, or falls short and
  fails. The emails the flow sends are captured into the story report.

  Scenario: a proposed game fails when too few are interested
    Given I am a confirmed player "Polly Propose" with email "polly@example.com" in ZIP "78701"
    When I propose a game at a nearby spot
    Then I am a captain of the proposed site
    When I open the game on the map
    Then the proposed site shows
    When the engine ticks
    Then the proposal email goes out
    When too few players are interested
    And the interest window closes and the engine ticks
    Then no game forms and the proposal fails
    And everyone hears the proposal fell short

  Scenario: a proposed game gets scheduled when enough are interested
    Given I am a confirmed player "Sam Spark" with email "sam@example.com" in ZIP "78701"
    When I propose a game at a nearby spot
    Then I am a captain of the proposed site
    When I open the game on the map
    Then the proposed site shows
    When the engine ticks
    Then the proposal email goes out
    When enough players are interested
    And the interest window closes and the engine ticks
    Then a game is scheduled here
    And I get the game-on email
    And I am a captain of the scheduled game
    When I refresh the map
    And I open the game on the map
    Then I am already in the game as its captain
