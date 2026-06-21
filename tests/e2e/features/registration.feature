Feature: Registration & email confirmation

  Scenario: a new player registers and shows interest in one step
    Given I open the landing page
    When I click "count me in"
    Then I see the registration form
    When I register as "Captain Test" with email "captain@example.com" password "hunter2pass" in ZIP "78701"
    Then I land on the map
    And I see the "email unconfirmed" banner
    And I receive a confirmation email

  Scenario: confirming my email drops me on the map
    Given I register as "Test Player" with email "confirm@example.com" password "hunter2pass" in ZIP "78701"
    When I click the confirm link in my email
    Then I land on the map
    And I do not see the "email unconfirmed" banner

  Scenario: a stale or used confirm link
    When I open an invalid confirm link
    Then I see the "this link didn't work" page

  Scenario: resending the confirmation email
    Given I register as "Re Send" with email "resend@example.com" password "hunter2pass" in ZIP "78701"
    And my inbox is empty
    When I click "resend" on the banner
    Then the resend button shows "sent"
    And I receive a confirmation email

  Scenario: an unconfirmed player cannot propose a game
    Given I register as "Pro Pose" with email "propose@example.com" password "hunter2pass" in ZIP "78701"
    When I right-click the map to propose a spot
    Then the propose form opens
    When I fill in the proposal and submit it
    Then I am told to confirm my email before proposing

  Scenario: an unconfirmed player cannot join a game
    Given an established weekly game near me
    And I register as "Joi Ner" with email "joingate@example.com" password "hunter2pass" in ZIP "78701"
    When I open the game on the map
    And I try to join the weekly game
    Then I am told to confirm my email
