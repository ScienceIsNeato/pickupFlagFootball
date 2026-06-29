Feature: One-click RSVP from the weekly email

  Scenario: confirming "i'm in" from the email link
    Given an established weekly game near me
    And I am a confirmed player "Reg Ular" with email "joiner@example.com" in ZIP "78701"
    And I am on the roster with a game scheduled this week
    When the engine ticks
    Then the weekly rsvp email reaches me
    When I open my "i'm in" rsvp link
    And I confirm the rsvp
    Then I'm marked in for the week
