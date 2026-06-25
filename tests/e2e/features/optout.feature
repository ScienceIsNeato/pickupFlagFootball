Feature: Not interested in a site

  Scenario: a player declines a forming site, then changes their mind
    Given a forming game site near me
    And I am a confirmed player "Dee Cline" with email "dee@example.com" in ZIP "78701"
    When I open the game on the map
    And I say I'm not interested in the site
    Then the site shows I opted out
    When I say I'm interested again
    Then the site offers the not-interested option

  Scenario: a player opts out from the courting email's one-click link
    Given a forming game site near me
    And I am a confirmed player "Em Out" with email "emout@example.com" in ZIP "78701"
    When I open my "not interested" email link
    And I confirm I'm not interested from the email
    Then I'm opted out of the site
