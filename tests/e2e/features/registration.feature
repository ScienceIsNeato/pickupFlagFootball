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
