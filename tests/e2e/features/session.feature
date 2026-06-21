Feature: Session integrity

  Scenario: a deleted account's stale session is treated as logged out
    Given I register as "Ghost User" with email "ghost@example.com" password "hunter2pass" in ZIP "78701"
    When my account is deleted from the database
    And I reload the page
    Then I am sent to sign in
