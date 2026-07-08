Feature: Terms of service

  Scenario: the terms are published and carry the liability language
    Given I open the terms page
    Then I see the assumption of risk and release of liability

  Scenario: signing up requires agreeing to the terms
    Given I open the landing page
    When I click "count me in"
    Then the signup form says creating an account accepts the terms

  Scenario: the site footer links to the terms
    Given I open the landing page
    Then the footer links to the terms page
