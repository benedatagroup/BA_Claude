sap.ui.define([
    "sap/ui/core/UIComponent",
    "baclaude/model/models",
    "baclaude/localService/mockserver"
], (UIComponent, models, mockserver) => {
    "use strict";

    // Start the mock server at module load time, before the component is instantiated.
    // The OData model declared in manifest.json with "preload: true" is created during
    // manifest processing (i.e. before Component#init runs), so intercepting XHRs from
    // inside init() would be too late.
    mockserver.init();

    return UIComponent.extend("baclaude.Component", {
        metadata: {
            manifest: "json",
            interfaces: [
                "sap.ui.core.IAsyncContentCreation"
            ]
        },

        init() {
            // call the base component's init function
            UIComponent.prototype.init.apply(this, arguments);

            // set the device model
            this.setModel(models.createDeviceModel(), "device");

            // enable routing
            this.getRouter().initialize();
        }
    });
});
