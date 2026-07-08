Feature: Changing your email

  Scenario: I fix a mistyped email and confirm the new one
    Given I am a confirmed player "Edit Ed" with email "ed-typo@example.com" in ZIP "78701"
    When I change my email to "ed-fixed@example.com"
    Then a confirmation is sent to "ed-fixed@example.com"
    And confirming that link verifies the new address
