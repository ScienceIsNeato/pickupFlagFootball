Feature: Account page

  Scenario: name and location save independently (neither wipes the other)
    Given I am a confirmed player "Acc Ount" with email "acc@example.com" in ZIP "78701"
    When I open my account
    And I rename myself to "Renamed Player"
    Then my account keeps name "Renamed Player" and zip "78701"
    When I change my travel distance to "25"
    Then my account keeps name "Renamed Player" and travel "25"
