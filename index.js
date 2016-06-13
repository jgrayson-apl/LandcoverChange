require([
  "dojo/ready",
  "dojo/_base/lang",
  "dojo/_base/array",
  "dojo/_base/Color",
  "dojo/colors",
  "dojo/number",
  "dojo/json",
  "dojo/Deferred",
  "dojo/promise/all",
  "dojo/aspect",
  "dojo/on",
  "dojo/query",
  "dojo/dom",
  "dojo/dom-class",
  "dojo/dom-attr",
  "dijit/registry",
  "dijit/ConfirmDialog",
  "put-selector/put",
  "esri/config",
  "esri/request",
  "esri/urlUtils",
  "esri/arcgis/utils",
  "esri/dijit/Search",
  "esri/dijit/Legend",
  "esri/dijit/LayerSwipe",
  "esri/dijit/BasemapGallery",
  "esri/dijit/HorizontalSlider",
  "esri/tasks/PrintParameters",
  "esri/tasks/PrintTemplate",
  "esri/tasks/PrintTask",
  "esri/dijit/Print",
  "esri/layers/RasterFunction",
  "esri/layers/MosaicRule"
], function (ready, lang, array, Color, colors, number, json, Deferred, all,
             aspect, on, query, dom, domClass, domAttr, registry, ConfirmDialog, put,
             esriConfig, esriRequest, urlUtils, arcgisUtils, Search, Legend, LayerSwipe, BasemapGallery, HorizontalSlider,
             PrintParameters, PrintTemplate, PrintTask, Print, RasterFunction, MosaicRule) {

  // WAIT UNTIL HTML AND DIJITS ARE READY //
  ready(function () {

    // FORCE HTTPS //
    //var notSecure = /http:/i;
    //if(notSecure.test(window.location.protocol)) {
    //  window.location = window.location.href.replace(notSecure, "https:");
    //}

    //
    // NOTE: THE CODE BELOW RELIES ON FINDING DOM NODES WITH THESE IDS //
    //
    var appInfoNodeId = "app-description";
    var aboutDialogNodeId = "about-dialog";
    var mapNodeId = "main-center-pane";
    var searchNodeId = "search-node";
    var mapScaleNodeId = "map-scale-node";

    // WEB MAP ID //
    var landCoverWebMapId = "1f1be83fb5984928b61d949f5f289039";

    // LOAD WEBMAP //
    loadWebMap(landCoverWebMapId);


    /**
     *  LOAD WEBMAP
     */
    function loadWebMap(webMapId) {

      // PROXY NEEDED FOR PRINTING //
      esriConfig.defaults.io.proxyUrl = "https://webappsproxy.esri.com/Oauth";

      arcgisUtils.createMap(webMapId, mapNodeId, {
        mapOptions: {
          sliderOrientation: "horizontal"
        },
        usePopupManager: true,
        layerMixins: [],
        editable: false
      }).then(lang.hitch(this, function (response) {

        // WEBMAP //
        this.webMap = response.itemInfo.itemData;
        // MAP//
        this.map = response.map;
        this.map.on("update-start", function () {
          this.map.setMapCursor("wait");
        }.bind(this));
        this.map.on("update-end", function () {
          this.map.setMapCursor("default");
        }.bind(this));


        // BASEMAP GALLERY //
        var basemapGallery = new BasemapGallery({
          map: this.map
        }, "basemap-gallery-node");
        basemapGallery.startup();
        // BASEMAP TITLE PANE ICON //
        query("#basemap-gallery-pane.dijitTitlePane .dijitArrowNode").addClass("esri-icon-basemap");


        // INITIALIZE MAP SCALE //
        initializeMapScale();

        // INITIALIZE PRINT //
        initializePrintMap();

        // CONFIGURE PLACE SEARCH //
        configurePlaceSearch();


        // NLCD IMAGE SERVICE //
        this.nlcdImageService = findWebMapLayerByTitle("NLCD Data Service");
        // UPDATE ON ALL EXTENT CHANGES //
        this.map.on("extent-change", updateChange.bind(this));
        // UPDATE ON FIRST MAP UPDATE //
        //on.once(this.map, "update-end", function () {
        //  updateChange({ extent: this.map.extent });
        //}.bind(this));

        // NLCD LAYERS //
        this.nlcd2011Layer = findWebMapLayerByTitle("NLCD 2011");
        this.nlcd2050Layer = findWebMapLayerByTitle("NLCD 2050");

        // INITIALIZE SWIPE //
        initializeSwipe(this.nlcd2011Layer);

        // OPACITY SLIDER //
        var opacitySlider = new HorizontalSlider({
          intermediateChanges: true,
          labels: ["opaque", "transparent"],
          minimum: 0.0,
          maximum: 1.0,
          discreteValues: 101,
          value: 0.0
        }, "opacity-slider-node");
        opacitySlider.on("change", function (value) {
          var newOpacity = (1.0 - value);
          this.nlcd2011Layer.setOpacity(newOpacity);
          this.nlcd2050Layer.setOpacity(newOpacity);
        }.bind(this));

        // LEGEND //
        var mapLegend = new Legend({
          map: this.map,
          layerInfos: [
            {
              title: "National Land Cover Database",
              layer: this.nlcd2011Layer
            }
          ]
        }, "legend-node");
        mapLegend.startup();

        // ABOUT DIALOG //
        on(dom.byId(appInfoNodeId), "click", function () {
          registry.byId(aboutDialogNodeId).show();
        }.bind(this));
        registry.byId(aboutDialogNodeId).show();

      }.bind(this)), console.warn);
    }

    /**
     *
     * @param layerTitle
     * @returns {*}
     * @private
     */
    function findWebMapLayerByTitle(layerTitle) {
      var foundMapLayer = null;
      array.forEach(this.webMap.operationalLayers, function (opLayer) {
        if(opLayer.title === layerTitle) {
          foundMapLayer = opLayer.layerObject;
        }
      }.bind(this));
      return foundMapLayer;
    }

    /**
     * INITIALIZE MAP SCALE //
     */
    function initializeMapScale() {

      // MAP SCALE NODE //
      var mapScaleNode = dom.byId(mapScaleNodeId);

      // UPDATE MAP SCALE //
      var updateMapScale = function (evt) {
        var mapScale = evt ? evt.lod.scale : this.map.getScale();
        mapScaleNode.innerHTML = lang.replace("1: {mapScale}", { mapScale: number.format(mapScale, { places: 0 }) });
      }.bind(this);

      // UPDATE MAP SCALE ON LEVEL CHANGE //
      this.map.on("extent-change", function (evt) {
        if(evt.levelChange) {
          updateMapScale(evt);
        }
      });

      // SET INITIAL MAP SCALE //
      updateMapScale();
    }

    /**
     *
     */
    function initializePrintMap() {

      // PRINT SERVICE URL //
      var PRINT_SERVICE_URL = "https://maps2.esri.com/apl3/rest/services/Utilities/PrintingTools/GPServer/Export%20Web%20Map%20Task";

      // PRINT TEMPLATE LAYOUT //
      var layoutOptions = {
        titleText: "Green Infrastructure Land Cover",
        authorText: "Esri",
        copyrightText: "Clark Labs and Esri",
        scalebarUnit: "Miles"
      };

      // GET AVAILABLE LAYOUT PRINT TEMPLATES //
      esriRequest({
        "url": PRINT_SERVICE_URL,
        "content": { "f": "json" }
      }).then(function (printInfo) {

        // TEMPLATES PARAMETER //
        var layoutTemplates = array.filter(printInfo.parameters, function (param, idx) {
          return param.name === "Layout_Template";
        });
        // TEMPLATE NAMES //
        var templateNames = layoutTemplates[0].choiceList;
        // CREATE AVAILABLE TEMPLATES //
        var templates = array.map(templateNames, function (templateName) {
          var template = new PrintTemplate();
          if(templateName === "MAP_ONLY") {
            template.layout = templateName;
            template.label = "Map Only (PNG)";
            template.format = "PNG32";
            template.exportOptions = {
              width: this.map.width,
              height: this.map.height,
              dpi: 96
            };
          } else {
            template.layout = template.label = templateName;
            template.format = "PDF";
            template.layoutOptions = layoutOptions;
          }
          return template;
        }.bind(this));

        // PRINT DIJIT //
        var printer = new Print({
          map: this.map,
          templates: templates,
          url: PRINT_SERVICE_URL
        }, dom.byId("print-map-btn"));
        printer.startup();

        // PRINT ERROR //
        printer.on("error", function (error) {
          // DISPLAY ERROR IN DIALOG //
          var errorMessageDialog = new ConfirmDialog({
            className: "gi-dialog",
            title: lang.replace("Print Error: {message}", error),
            content: array.map(error.details, function (detail) {
              return put("div.error-detail", detail);
            }.bind(this))
          });
          domClass.add(errorMessageDialog.cancelButton.domNode, "dijitHidden");
          errorMessageDialog.show();
        }.bind(this));

      }.bind(this), console.warn);

    }

    /**
     * CONFIGURE PLACE SEARCH
     */
    function configurePlaceSearch() {

      //
      // SEARCH //
      //
      var search = new Search({
        map: this.map,
        enableHighlight: true,
        enableInfoWindow: false
      }, searchNodeId);

      // SEARCH SOURCES //
      var sources = search.get("sources");

      // WORLD GEOCODER //
      var worldGeocoder = sources[0];
      worldGeocoder.countryCode = "USA";
      worldGeocoder.minCharacters = 2;
      worldGeocoder.maxSuggestions = 9;

      // RESET SEARCH SOURCES TO CUSTOMIZED WORLD GEOCODER //
      search.set("sources", [worldGeocoder]);
      search.startup();
      search.focus();


      // BOOKMARKS //
      query(".zoom-to-city").on("click", function (evt) {
        var cityName = domAttr.get(evt.currentTarget, "data-city");
        if(cityName) {
          //search.set("value", cityName);
          search.search(cityName);
        }
      });

    }

    /**
     *
     * @param layerToSwipe
     */
    function initializeSwipe(layerToSwipe) {

      // LAYER SWIPE //
      var layerSwipe = new LayerSwipe({
        map: this.map,
        visible: true,
        enabled: true,
        left: (this.map.width * 0.5),
        layers: [layerToSwipe]
      }, put(this.map.root, "-div"));
      layerSwipe.startup();

      // SWIPE LABEL //
      var handleNode = query(".handle", layerSwipe._moveableNode)[0];
      put(handleNode, "+div.movable-label", { innerHTML: lang.replace("{0}&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;{1}", ["2011", "2050"]) });

    }

    /**
     *
     * @param value
     * @returns {*}
     */
    function formatPercent(value) {
      return lang.replace("{plusMinus}{integerValue}%", {
        plusMinus: (value > 0.0) ? "+" : "",
        integerValue: value.toFixed((Math.abs(value) < 1.0) ? 1 : 0)
      });
    }

    /**
     *
     * @param value2011
     * @param value2050
     */
    function computeChange(value2011, value2050) {

      if((value2011 > 0.0) && (value2050 > 0.0)) {
        if(value2011 === value2050) {
          return formatPercent(0);
        } else {
          return formatPercent(((value2050 - value2011) / value2011) * 100.0);
        }
      } else {
        if((!value2011) && (!value2050)) {
          return "n/a";
        } else {
          if(!value2011) {
            return formatPercent(100);
          } else {
            if(!value2050) {
              return formatPercent(-100);
            }
          }
        }
      }
    }

    /**
     *
     * @param evt
     */
    function updateChange(evt) {

      if(this.nlcdImageService) {

        // UPDATING NODE //
        query(".change-node").addClass("updating");

        // PIXEL SIZE IN METERS //
        // NOTE: DECREASED CELL SIZE BY 3 TIMES TO GET MORE ACCURATE RESULTS //
        var mapWidthMeters = Math.min(this.map.extent.getWidth(), this.nlcdImageService.fullExtent.getWidth());
        var pixelSizeMeters = (mapWidthMeters / this.map.width) * 0.333;

        all({
          "histogram2011": getHistogram(this.nlcdImageService, 4, evt.extent, pixelSizeMeters),
          "histogram2050": getHistogram(this.nlcdImageService, 1, evt.extent, pixelSizeMeters)
        }).then(function (histogramsResponses) {
          // UPDATING NODE //
          query(".change-node").removeClass("updating");

          // HISTOGRAMS //
          var histogram2011 = histogramsResponses.histogram2011;
          var histogram2050 = histogramsResponses.histogram2050;

          // NLCD CLASS //
          var developedClass = 20;
          var forestsClass = 40;
          var cropsClass = 82;

          // CELL COUNTS //
          var cellCount_2011_developed = histogram2011[developedClass] || 0;
          var cellCount_2011_forests = histogram2011[forestsClass] || 0;
          var cellCount_2011_crops = histogram2011[cropsClass] || 0;
          var cellCount_2050_developed = histogram2050[developedClass] || 0;
          var cellCount_2050_forests = histogram2050[forestsClass] || 0;
          var cellCount_2050_crops = histogram2050[cropsClass] || 0;

          // CELL AS ACRE //
          var acrePerSqMeter = 0.000247105;
          var cellAsAcre = (pixelSizeMeters * pixelSizeMeters) * acrePerSqMeter;

          // CHANGE //
          var changeDetails = {
            developed: {
              acres_2011: number.format(cellCount_2011_developed * cellAsAcre, { places: 0 }),
              acres_2050: number.format(cellCount_2050_developed * cellAsAcre, { places: 0 }),
              change: computeChange(cellCount_2011_developed, cellCount_2050_developed)
            },
            forests: {
              acres_2011: number.format(cellCount_2011_forests * cellAsAcre, { places: 0 }),
              acres_2050: number.format(cellCount_2050_forests * cellAsAcre, { places: 0 }),
              change: computeChange(cellCount_2011_forests, cellCount_2050_forests)
            },
            crops: {
              acres_2011: number.format(cellCount_2011_crops * cellAsAcre, { places: 0 }),
              acres_2050: number.format(cellCount_2050_crops * cellAsAcre, { places: 0 }),
              change: computeChange(cellCount_2011_crops, cellCount_2050_crops)
            }
          };

          // CHANGE PERCENTAGE //
          dom.byId("info-node-developed").innerHTML = changeDetails.developed.change;
          dom.byId("info-node-forests").innerHTML = changeDetails.forests.change;
          dom.byId("info-node-crops").innerHTML = changeDetails.crops.change;

          // CHANGE AMOUNTS //
          dom.byId("details-node-developed").innerHTML = lang.replace("{acres_2011} acres in 2011 vs {acres_2050} acres in 2050", changeDetails.developed);
          dom.byId("details-node-forests").innerHTML = lang.replace("{acres_2011} acres in 2011 vs {acres_2050} acres in 2050", changeDetails.forests);
          dom.byId("details-node-crops").innerHTML = lang.replace("{acres_2011} acres in 2011 vs {acres_2050} acres in 2050", changeDetails.crops);

        }.bind(this), console.warn);

      }
    }

    /**
     *
     * @param isLayer
     * @param rasterId
     * @param extent
     * @param pixelSizeMeters
     */
    function getHistogram(isLayer, rasterId, extent, pixelSizeMeters) {

      var mosaicRule = new MosaicRule();
      mosaicRule.method = MosaicRule.METHOD_LOCKRASTER;
      mosaicRule.lockRasterIds = [rasterId];

      //mosaicRule.method = MosaicRule.METHOD_ATTRIBUTE;
      //mosaicRule.where = lang.replace("YEAR = {0}",[year]);


      var renderingRule = new RasterFunction();
      renderingRule.functionName = "Colormap";
      renderingRule.functionArguments = {
        "Colormap": [
          [11, 71, 107, 160],  // Open Water
          [12, 209, 221, 249], // Perennial Ice/Snow
          [20, 170, 0, 0],     // Developed
          [31, 178, 173, 163], // Barren Land (Rock/Sand/Clay)
          [40, 28, 99, 48],    // Forests
          [50, 204, 186, 124], // Shrub/Scrub
          [70, 226, 226, 193], // Grassland/Herbaceous
          [81, 219, 216, 61],  // Pasture/Hay
          [82, 170, 112, 40],  // Cultivated Crops
          [90, 112, 163, 186]  // Herbaceous and Woody Wetlands
        ]
      };
      renderingRule.outputPixelType = "U8";

      return esriRequest({
        url: lang.replace("{url}/computehistograms", isLayer),
        content: {
          geometryType: "esriGeometryEnvelope",
          geometry: json.stringify(extent.toJson()),
          renderingRule: json.stringify(renderingRule.toJson()),
          mosaicRule: json.stringify(mosaicRule.toJson()),
          pixelSize: lang.replace("{0},{0}", [pixelSizeMeters]),
          f: "json"
        }
      }).then(function (histogramsResponse) {
        return histogramsResponse.histograms[0].counts;
      }.bind(this), console.warn);

    }

    /*
     function updateChange_FULL(evt) {

     if(this.nlcdImageService) {

     // UPDATING NODE //
     query(".change-node").addClass("updating");

     all({
     "histogram2011": getHistogram_FULL(this.nlcdImageService, 4, evt.extent),
     "histogram2050": getHistogram_FULL(this.nlcdImageService, 1, evt.extent)
     }).then(function (histogramsResponses) {
     // UPDATING NODE //
     query(".change-node").removeClass("updating");

     // HISTOGRAMS //
     var histogram2011 = histogramsResponses.histogram2011;
     var histogram2050 = histogramsResponses.histogram2050;

     // CELL AS ACRE //
     var cellAsAcre = 0.222395;

     // NLCD CLASS //
     var developedClass = 20;
     var forestsClass = 40;
     var cropsClass = 82;

     var changeDetails = {
     developed: {
     acres_2011: number.format(histogram2011[developedClass] * cellAsAcre, { places: 0 }),
     acres_2050: number.format(histogram2050[developedClass] * cellAsAcre, { places: 0 }),
     change: computeChange(histogram2011[developedClass], histogram2050[developedClass])
     },
     forests: {
     acres_2011: number.format(histogram2011[forestsClass] * cellAsAcre, { places: 0 }),
     acres_2050: number.format(histogram2050[forestsClass] * cellAsAcre, { places: 0 }),
     change: computeChange(histogram2011[forestsClass], histogram2050[forestsClass])
     },
     crops: {
     acres_2011: number.format(histogram2011[cropsClass] * cellAsAcre, { places: 0 }),
     acres_2050: number.format(histogram2050[cropsClass] * cellAsAcre, { places: 0 }),
     change: computeChange(histogram2011[cropsClass], histogram2050[cropsClass])
     }
     };

     dom.byId("info-node-developed").innerHTML = changeDetails.developed.change;
     dom.byId("info-node-forests").innerHTML = changeDetails.forests.change;
     dom.byId("info-node-crops").innerHTML = changeDetails.crops.change;

     dom.byId("details-node-developed").innerHTML = lang.replace("{acres_2011} acres in 2011 vs {acres_2050} acres in 2050", changeDetails.developed);
     dom.byId("details-node-forests").innerHTML = lang.replace("{acres_2011} acres in 2011 vs {acres_2050} acres in 2050", changeDetails.forests);
     dom.byId("details-node-crops").innerHTML = lang.replace("{acres_2011} acres in 2011 vs {acres_2050} acres in 2050", changeDetails.crops);

     }.bind(this), console.warn);

     }
     }

     function getHistogram_FULL(isLayer, rasterId, extent) {

     var mosaicRule = new MosaicRule();
     mosaicRule.method = MosaicRule.METHOD_LOCKRASTER;
     mosaicRule.lockRasterIds = [rasterId];

     var renderingRule = new RasterFunction();
     renderingRule.functionName = "Colormap";
     renderingRule.functionArguments = {
     "Colormap": [
     [11, 71, 107, 160],  // Open Water
     [12, 209, 221, 249], // Perennial Ice/Snow
     [20, 170, 0, 0],     // Developed
     [31, 178, 173, 163], // Barren Land (Rock/Sand/Clay)
     [40, 28, 99, 48],    // Forests
     [50, 204, 186, 124], // Shrub/Scrub
     [70, 226, 226, 193], // Grassland/Herbaceous
     [81, 219, 216, 61],  // Pasture/Hay
     [82, 170, 112, 40],  // Cultivated Crops
     [90, 112, 163, 186]  // Herbaceous and Woody Wetlands
     ]
     };
     renderingRule.outputPixelType = "U8";

     return esriRequest({
     url: lang.replace("{url}/computehistograms", isLayer),
     content: {
     geometryType: "esriGeometryEnvelope",
     geometry: json.stringify(extent.toJson()),
     renderingRule: json.stringify(renderingRule.toJson()),
     mosaicRule: json.stringify(mosaicRule.toJson()),
     f: "json"
     }
     }).then(function (histogramsResponse) {
     return histogramsResponse.histograms[0].counts;
     }.bind(this), console.warn);

     }
     */


  });
});
