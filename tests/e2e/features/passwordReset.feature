Feature: Password reset

  Scenario: I reset a forgotten password and sign in with the new one
    Given I am a confirmed player "Reset Rita" with email "rita@example.com" in ZIP "78701"
    And I am signed out
    When I request a password reset for "rita@example.com"
    And I open the reset link and set my password to "brandnewpass9"
    Then I can sign in with "rita@example.com" and "brandnewpass9"

  Scenario: an invalid or expired reset link
    When I open an invalid reset link
    Then I'm told the reset link is invalid
