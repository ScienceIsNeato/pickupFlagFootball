Feature: Donations (Stripe subscription)

  Scenario: a Stripe subscription keeps donation status in sync
    Given I am a confirmed player "Dona Tor" with email "dona@example.com" in ZIP "78701"
    When Stripe reports their subscription started
    Then they're marked as a subscriber
    When Stripe reports their subscription cancelled
    Then the donation reminder is back on
