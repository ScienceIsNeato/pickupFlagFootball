Feature: Session integrity

  Scenario: a deleted account's stale session is treated as logged out
    Given I register as "Ghost User" with email "ghost@example.com" password "hunter2pass" in ZIP "78701"
    Then after my account is deleted, reloading sends me to sign in
