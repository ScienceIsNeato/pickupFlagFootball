Feature: Registration & email confirmation

  Scenario: a new player registers and shows interest in one step
    Given I open the landing page
    When I click "count me in"
    And I register as "Captain Test" with email "captain@example.com" password "hunter2pass" in ZIP "78701"
    Then I receive a confirmation email

  Scenario: confirming my email drops me on the map
    Given I register as "Test Player" with email "confirm@example.com" password "hunter2pass" in ZIP "78701"
    When I click the confirm link in my email

  Scenario: a mail scanner can't burn my confirm token
    Given I register as "Scan Ner" with email "scanner@example.com" password "hunter2pass" in ZIP "78701"
    When a mail scanner opens the confirm link
    Then the confirm link still works for me

  Scenario: a stale or used confirm link
    When I open an invalid confirm link

  Scenario: resending the confirmation email
    Given I register as "Re Send" with email "resend@example.com" password "hunter2pass" in ZIP "78701"
    When I resend the confirmation from the banner
    Then I receive a confirmation email

  Scenario: an unconfirmed player cannot propose a game
    Given I register as "Pro Pose" with email "propose@example.com" password "hunter2pass" in ZIP "78701"
    When I right-click the map to propose a spot
    Then filling in the proposal tells me to confirm my email

  Scenario: an unconfirmed player cannot join a game
    Given an established weekly game near me
    And I register as "Joi Ner" with email "joingate@example.com" password "hunter2pass" in ZIP "78701"
    When I open the game on the map
    Then trying to join tells me to confirm my email
