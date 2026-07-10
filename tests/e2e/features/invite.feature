Feature: Invite a friend

  Scenario: I invite a friend and they get a join link
    Given I am a confirmed player "Ida Vite" with email "ida@example.com" in ZIP "78701"
    When I open the invite-a-friend dialog
    And I fill in my friend's email "newfriend@example.com"
    And I send the invite
    Then a join-link email reaches "newfriend@example.com"
