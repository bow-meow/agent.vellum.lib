-- Fixture (the // annotations are for opengrep --test, which does not read -- comments in generic mode) for sql.yml: "ruleid:" lines must match, "ok:" lines must not. opengrep scan --test rules/
ALTER PROCEDURE [dbo].[ReaderAddressInfoQuery]
(
 @DeviceID int
)
As
 // ruleid: proc-if-else-two-selects
 IF @DeviceID <= 0
  SELECT ReaderTable.ReaderID AS DeviceID,
      ReaderTable.CompanyID
  FROM ReaderTable
 ELSE
  SELECT ReaderTable.ReaderID AS DeviceID,
      ReaderTable.CompanyID
  FROM ReaderTable
  WHERE ReaderTable.ReaderID = @DeviceID
GO

ALTER PROCEDURE [dbo].[SingleSelectQuery]
(
 @DeviceID int
)
As
 // ok: proc-if-else-two-selects
 SELECT ReaderTable.ReaderID
 FROM ReaderTable
 WHERE @DeviceID <= 0 OR ReaderTable.ReaderID = @DeviceID
GO
