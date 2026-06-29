Feature: Not interested in a proposal

  "Not interested" declines just this proposal — a different nearby proposal can
  still reach you. From the map popup, or one-click from the proposal email.

  Scenario: a player says not interested, then changes their mind
    Given a forming game site near me
    And I am a confirmed player "Dee Cline" with email "dee@example.com" in ZIP "78701"
    When I open the game on the map
    And I say I'm not interested
    Then the proposal shows I'm out
    When I say I'm interested after all
    Then the proposal shows I'm in

  Scenario: a player says not interested from the proposal email link
    Given I am a confirmed player "Em Out" with email "emout@example.com" in ZIP "78701"
    And a neighbor proposes a game near me, asking me in
    When the engine ticks
    Then the proposal email reaches me
    When I open my not-interested email link
    And I confirm not interested from the email
    Then I'm marked not interested
