sap.ui.define([
    "sap/ui/core/util/MockServer",
    "sap/base/Log"
], (MockServer, Log) => {
    "use strict";

    return {

        /**
         * Initializes the mock server. The mock server intercepts XHR requests against the OData service URL
         * configured in manifest.json and answers them with the local metadata and JSON mock data.
         */
        init() {
            const oUriParameters = new URLSearchParams(window.location.search);
            const sJsonFilesUrl = sap.ui.require.toUrl("baclaude/localService/mockdata");
            const sMetadataUrl = sap.ui.require.toUrl("baclaude/localService/metadata.xml");
            const sMockServerUrl = "/sap/opu/odata/sap/INVOICE_SRV/";

            const oMockServer = new MockServer({
                rootUri: sMockServerUrl
            });

            MockServer.config({
                autoRespond: true,
                autoRespondAfter: parseInt(oUriParameters.get("serverDelay"), 10) || 250
            });

            oMockServer.simulate(sMetadataUrl, {
                sMockdataBaseUrl: sJsonFilesUrl,
                bGenerateMissingMockData: true
            });

            oMockServer.start();

            Log.info("Mock server started for service " + sMockServerUrl);
        }
    };
});
