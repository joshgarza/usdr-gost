const _ = require('lodash');
const { expect } = require('chai');
const sinon = require('sinon');
const { processMessages, receiveNextMessageBatch } = require('../../src/lib/grants-ingest');

describe('processMessages', async () => {
    const queueUrl = 'https://sqs.us-west-2.amazonaws.com/123456789012/grants-ingest-events';
    let knexQuery;
    let knexStub;
    let sqsStub;

    beforeEach(() => {
        knexQuery = {
            insert: sinon.stub().returnsThis(),
            onConflict: sinon.stub().returnsThis(),
            merge: sinon.stub().returnsThis(),
            returning: sinon.stub().resolves(),
        };
        knexStub = sinon.stub().returns(knexQuery);
        sqsStub = { send: sinon.stub() };
    });

    afterEach(() => {
        sinon.restore();
    });

    it('should process messages successfully', async () => {
        const jsonMatcher = (expectedString) => (actualString) => _.isEqual(JSON.parse(expectedString), JSON.parse(actualString));
        const messages = [
            {
                Body: JSON.stringify({
                    OpportunityId: '1',
                    OpportunityNumber: 'for-some-reason-not-a-number',
                    AgencyCode: 'ABC-ZYX-QMWN',
                    AwardCeiling: '98765',
                    AwardFloor: '12345',
                    CostSharingOrMatchingRequirement: true,
                    OpportunityTitle: 'Great opportunity',
                    CFDANumbers: ['12.345'],
                    PostDate: '2023-06-05',
                    CloseDate: '2024-01-02',
                    OpportunityCategory: 'O',
                    Description: 'Here is a description of this cool grant',
                    EligibleApplicants: ['00', '01', '02', '03'],
                }),
                ReceiptHandle: 'receipt-handle-2',
            },
            {
                Body: JSON.stringify({
                    OpportunityId: '2',
                    OpportunityNumber: 'nope-no-numbers-here',
                    AgencyCode: 'ZYX-ABC-PZOX',
                    AwardCeiling: '987',
                    AwardFloor: 'unparseable',
                    CostSharingOrMatchingRequirement: false,
                    OpportunityTitle: 'Awesome opportunity',
                    CFDANumbers: ['98.765', '87.654'],
                    PostDate: '2023-05-06',
                    OpportunityCategory: 'M',
                    Description: 'Here is a description of this awesome grant',
                    EligibleApplicants: ['25', '20', '13', '12', '11', '10'],
                }),
                ReceiptHandle: 'receipt-handle-1',
            },
            {
                Body: JSON.stringify({
                    grant_id: '3',
                    OpportunityNumber: 'not-a-number-either',
                    AgencyCode: 'CUVY-MWN-IVUB',
                    AwardCeiling: 'unparseable',
                    AwardFloor: '7654',
                    CostSharingOrMatchingRequirement: false,
                    OpportunityTitle: 'Superb opportunity',
                    CFDANumbers: ['98.765', '87.654'],
                    PostDate: '05062023',
                    OpportunityCategory: 'M',
                    Description: 'Here is a description of this superb grant',
                    EligibleApplicants: ['25', '20', '13', '12', '11', '10'],
                }),
                ReceiptHandle: 'receipt-handle-1',
            },
        ];

        await processMessages(knexStub, sqsStub, queueUrl, messages);

        sinon.assert.calledWithExactly(knexStub, 'grants');
        sinon.assert.callCount(knexStub, messages.length);
        sinon.assert.calledWith(knexQuery.insert, sinon.match({
            status: 'inbox',
            grant_id: '1',
            grant_number: 'for-some-reason-not-a-number',
            agency_code: 'ABC-ZYX-QMWN',
            award_ceiling: 98765,
            award_floor: 12345,
            cost_sharing: 'Yes',
            title: 'Great opportunity',
            cfda_list: '12.345',
            open_date: '2023-06-05',
            close_date: '2024-01-02',
            notes: 'auto-inserted by script',
            search_terms: '[in title/desc]+',
            reviewer_name: 'none',
            opportunity_category: 'Other',
            description: 'Here is a description of this cool grant',
            eligibility_codes: '00 01 02 03',
            opportunity_status: 'posted',
            raw_body: sinon.match(jsonMatcher(messages[0].Body)),
        }));
        sinon.assert.calledWith(knexQuery.insert, sinon.match({
            status: 'inbox',
            grant_id: '2',
            grant_number: 'nope-no-numbers-here',
            agency_code: 'ZYX-ABC-PZOX',
            award_ceiling: 987,
            award_floor: undefined,
            cost_sharing: 'No',
            title: 'Awesome opportunity',
            cfda_list: '98.765, 87.654',
            open_date: '2023-05-06',
            close_date: '2100-01-01',
            notes: 'auto-inserted by script',
            search_terms: '[in title/desc]+',
            reviewer_name: 'none',
            opportunity_category: 'Mandatory',
            description: 'Here is a description of this awesome grant',
            eligibility_codes: '25 20 13 12 11 10',
            opportunity_status: 'posted',
            raw_body: sinon.match(jsonMatcher(messages[1].Body)),
        }));
        sinon.assert.calledWith(knexQuery.insert, sinon.match({
            status: 'inbox',
            grant_id: '3',
            grant_number: 'not-a-number-either',
            agency_code: 'CUVY-MWN-IVUB',
            award_ceiling: undefined,
            award_floor: 7654,
            cost_sharing: 'No',
            title: 'Superb opportunity',
            cfda_list: '98.765, 87.654',
            open_date: '2023-05-06',
            close_date: '2100-01-01',
            notes: 'auto-inserted by script',
            search_terms: '[in title/desc]+',
            reviewer_name: 'none',
            opportunity_category: 'Mandatory',
            description: 'Here is a description of this superb grant',
            eligibility_codes: '25 20 13 12 11 10',
            opportunity_status: 'posted',
            raw_body: sinon.match(jsonMatcher(messages[2].Body)),
        }));
        sinon.assert.callCount(sqsStub.send, messages.length);
        sinon.assert.calledWith(sqsStub.send, sinon.match({
            input: { QueueUrl: queueUrl, ReceiptHandle: messages[0].ReceiptHandle },
        }));
        sinon.assert.calledWith(sqsStub.send, sinon.match({
            input: { QueueUrl: queueUrl, ReceiptHandle: messages[1].ReceiptHandle },
        }));
    });

    it('should skip processing message when error parsing json', async () => {
        const messages = [
            {
                Body: JSON.stringify({ OpportunityId: 1, PostDate: '05062023' }),
                ReceiptHandle: 'receipt-handle-1',
            },
            {
                Body: 'invalid-json',
                ReceiptHandle: 'receipt-handle-2',
            },
        ];

        await processMessages(knexStub, sqsStub, queueUrl, messages);

        sinon.assert.calledWithExactly(knexStub, 'grants');
        sinon.assert.callCount(knexStub, 1);
        sinon.assert.calledWith(knexQuery.insert, sinon.match({ grant_id: 1 }));
        sinon.assert.callCount(sqsStub.send, 1);
        sinon.assert.calledWith(sqsStub.send, sinon.match({
            input: { QueueUrl: queueUrl, ReceiptHandle: messages[0].ReceiptHandle },
        }));
    });

    it('should skip processing message when error parsing date', async () => {
        const messages = [
            {
                Body: JSON.stringify({ OpportunityId: 1, PostDate: '06072023' }),
                ReceiptHandle: 'receipt-handle-1',
            },
            {
                Body: JSON.stringify({
                    OpportunityId: 2,
                    PostDate: 'this-date-cannot-be-parsed PM',
                }),
                ReceiptHandle: 'receipt-handle-2',
            },
        ];

        await processMessages(knexStub, sqsStub, queueUrl, messages);

        sinon.assert.calledWithExactly(knexStub, 'grants');
        sinon.assert.callCount(knexStub, 1);
        sinon.assert.calledWith(knexQuery.insert, sinon.match({ grant_id: 1 }));
        sinon.assert.callCount(sqsStub.send, 1);
        sinon.assert.calledWith(sqsStub.send, sinon.match({
            input: { QueueUrl: queueUrl, ReceiptHandle: messages[0].ReceiptHandle },
        }));
    });

    it('should not delete the sqs message when error saving grant', async () => {
        const messages = [
            {
                Body: JSON.stringify({ OpportunityId: 1, PostDate: '2023-06-07' }),
                ReceiptHandle: 'receipt-handle-1',
            },
            {
                Body: JSON.stringify({ OpportunityId: 2, PostDate: '2023-06-07' }),
                ReceiptHandle: 'receipt-handle-2',
            },
        ];
        knexQuery.insert
            .withArgs(sinon.match({ grant_id: 1 }))
            .throws(new Error('Some knex error'));

        await processMessages(knexStub, sqsStub, queueUrl, messages);

        sinon.assert.calledWithExactly(knexStub, 'grants');
        sinon.assert.callCount(knexStub, 2);
        sinon.assert.calledWith(knexQuery.insert, sinon.match({ grant_id: 1 }));
        sinon.assert.callCount(sqsStub.send, 1);
        sinon.assert.calledWith(sqsStub.send, sinon.match({
            input: { QueueUrl: queueUrl, ReceiptHandle: messages[1].ReceiptHandle },
        }));
    });
});

describe('receiveNextMessageBatch', () => {
    const queueUrl = 'https://sqs.us-west-2.amazonaws.com/123456789012/grants-ingest-events';
    const receiveCommandArgs = { QueueUrl: queueUrl, WaitTimeSeconds: 20, MaxNumberOfMessages: 10 };
    let sqsStub;

    beforeEach(() => {
        sqsStub = { send: sinon.stub() };
    });

    afterEach(() => {
        sinon.restore();
    });

    it('should receive messages successfully', async () => {
        const response = {
            Messages: [
                { MessageId: 'message-id-1' },
                { MessageId: 'message-id-2' },
            ],
        };
        sqsStub.send
            .withArgs(sinon.match({ input: receiveCommandArgs }))
            .returns(response);

        const messages = await receiveNextMessageBatch(sqsStub, queueUrl);

        sinon.assert.callCount(sqsStub.send, 1);
        expect(messages).to.deep.equal(response.Messages);
    });
    it('should return an empty array if no messages received', async () => {
        sqsStub.send
            .withArgs(sinon.match({ input: receiveCommandArgs }))
            .returns({});

        const messages = await receiveNextMessageBatch(sqsStub, queueUrl);

        expect(sqsStub.send.calledOnce).to.be.true;
        expect(messages).to.deep.equal([]);
    });

    it('should return an empty array if no messages in response', async () => {
        sqsStub.send
            .withArgs(sinon.match({ input: receiveCommandArgs }))
            .returns({ Messages: [] });

        const messages = await receiveNextMessageBatch(sqsStub, queueUrl);

        expect(sqsStub.send.calledOnce).to.be.true;
        expect(messages).to.deep.equal([]);
    });
});
