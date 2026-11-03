// Fixture for cpp-mfc.yml: "ruleid:" lines must match, "ok:" lines must not. opengrep scan --test rules/
#include "stdafx.h"

void CAlarmViewForm::StartWorkers()
{
    // ruleid: afxbeginthread-null-check-only
    m_Worker = (CTxnTasksThread*)AfxBeginThread(RUNTIME_CLASS(CTxnTasksThread), THREAD_PRIORITY_NORMAL, 0, 0);
    if (m_Worker != NULL)
        m_Worker->SetQueueLimit(1000, true);
    // ok: afxbeginthread-null-check-only
    StartSuspendedAndWait();
}

void CSendAction::Execute(CCustomDatabase*, CCustomDatabase*, CCOMInterface*)
{
    static CConditionalCommandMessageQueue* s_pQueue = new CConditionalCommandMessageQueue(false);
    // ruleid: worker-execute-send-without-catch
    s_pQueue->AddToMessageQueue();
}

void CGuardedAction::Execute(CCustomDatabase*, CCustomDatabase*, CCOMInterface*)
{
    try
    {
        // ok: worker-execute-send-without-catch
        m_pQueue->AddToMessageQueue();
    }
    catch (...)
    {
        App.LogEvent(_T("send failed"));
    }
}

CConditionalCommandMessageQueue::CConditionalCommandMessageQueue(bool receive)
{
    // ruleid: msmq-time-to-be-received
    SetTimeToBeReceived(60);
    // ok: msmq-time-to-be-received
    OpenPrivateSendQueue(strComputerName, strLabel);
}
