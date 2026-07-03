Feature: Donations

  Scenario: a member can self-declare as a supporter and stop the asks
    Given I am a confirmed player "Support Sue" with email "sue@example.com" in ZIP "78701"
    And an established weekly game near me
    And I am on that game's roster
    When I mark myself as a supporter in account settings
    Then I'm marked as a supporter
    And I do not see the support banner on the map

  Scenario: a Stripe subscription keeps donation status in sync
    Given I am a confirmed player "Dona Tor" with email "dona@example.com" in ZIP "78701"
    When Stripe reports their subscription started
    Then they're marked as a subscriber
    When Stripe reports their subscription cancelled
    Then the donation reminder is back on

  Scenario: an active member sees the support nudge and can switch it off
    Given I am a confirmed player "Member Mike" with email "mike@example.com" in ZIP "78701"
    And an established weekly game near me
    And I am on that game's roster
    When I open the map
    Then I see the support banner
    When I dismiss the support banner with "stop asking for contributions"
    Then the support banner is gone
    And the donation reminder is off

  Scenario: the account checkbox controls the support nudge
    Given I am a confirmed player "Toggle Tina" with email "tina@example.com" in ZIP "78701"
    And an established weekly game near me
    And I am on that game's roster
    When I turn off the donation reminder in account settings
    Then the donation reminder is off
    And I do not see the support banner on the map
    When I turn on the donation reminder in account settings
    Then I see the support banner
