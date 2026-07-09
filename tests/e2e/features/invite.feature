Feature: Invite a friend

  Scenario: I invite a friend and they get a join link
    Given I am a confirmed player "Ida Vite" with email "ida@example.com" in ZIP "78701"
    When I invite a friend at "newfriend@example.com"
    Then a join-link email reaches "newfriend@example.com"
