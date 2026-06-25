Feature: A game forms (formation FSM)

  Scenario: interest becomes a scheduled game
    Given a site forming near me
    And I am a confirmed player "Vera Form" with email "vera@example.com" in ZIP "78701"
    When I open the game on the map
    Then the proposed site shows
    When the suggestion window closes and the engine ticks
    And enough players commit to a spot
    And the availability window closes and the engine ticks
    Then a game is scheduled here
    When I refresh the map
    And I open the game on the map
    Then the game is on

  Scenario: a formation stalls when too few commit
    Given a site forming near me
    And I am a confirmed player "Stan Led" with email "stan@example.com" in ZIP "78701"
    When I open the game on the map
    Then the proposed site shows
    When the suggestion window closes and the engine ticks
    And too few players commit
    And the availability window closes and the engine ticks
    Then no game forms and the site stalls
