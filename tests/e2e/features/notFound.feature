Feature: Not-found page

  Scenario: a bad URL gets a branded 404 with a way out
    When I open a URL that doesn't exist
    Then I see the branded not-found page with a way home
