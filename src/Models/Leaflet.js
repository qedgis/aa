'use strict';

/*global require,html2canvas,L*/
var Cartesian2 = require('../../third_party/cesium/Source/Core/Cartesian2');
var Cartographic = require('../../third_party/cesium/Source/Core/Cartographic');
var CesiumMath = require('../../third_party/cesium/Source/Core/Math');
var defined = require('../../third_party/cesium/Source/Core/defined');
var destroyObject = require('../../third_party/cesium/Source/Core/destroyObject');
var DeveloperError = require('../../third_party/cesium/Source/Core/DeveloperError');
var Ellipsoid = require('../../third_party/cesium/Source/Core/Ellipsoid');
var Rectangle = require('../../third_party/cesium/Source/Core/Rectangle');
var when = require('../../third_party/cesium/Source/ThirdParty/when');

var GlobeOrMap = require('./GlobeOrMap');
var inherit = require('../Core/inherit');
var LeafletScene = require('../Map/LeafletScene');
var PickedFeatures = require('../Map/PickedFeatures');
var rectangleToLatLngBounds = require('../Map/rectangleToLatLngBounds');
var runLater = require('../Core/runLater');

var Leaflet = function(application, map) {
    GlobeOrMap.call(this);

    this.application = application;

    /**
     * Gets or sets the Leaflet {@link Map} instance.
     * @type {Map}
     */
    this.map = map;

    this.scene = new LeafletScene(map);

    this._pickedFeatures = undefined;

    this.scene.featureClicked.addEventListener(featurePicked.bind(undefined, this));

    var that = this;
    map.on('preclick', function() {
        prePickFeatures(that);
    });

    map.on('click', function(e) {
        pickFeatures(that, e.latlng);
    });

    function raiseMapViewChanged() {
        that.application.mapViewChanged.raiseEvent();
    }

    map.on('zoomend', raiseMapViewChanged);
    map.on('move', raiseMapViewChanged);
};

inherit(GlobeOrMap, Leaflet);

Leaflet.prototype.destroy = function() {
    return destroyObject(this);
};

/**
 * Gets the current extent of the camera.  This may be approximate if the viewer does not have a strictly rectangular view.
 * @return {Rectangle} The current visible extent.
 */
Leaflet.prototype.getCurrentExtent = function() {
    var bounds = this.map.getBounds();
    return Rectangle.fromDegrees(bounds.getWest(), bounds.getSouth(), bounds.getEast(), bounds.getNorth());
};

/**
 * Zooms to a specified camera view or extent.
 *
 * @param {CameraView|Rectangle} viewOrExtent The view or extent to which to zoom.
 * @param {Number} [flightDurationSeconds=3.0] The length of the flight animation in seconds.  Leaflet ignores the actual value,
 *                                             but will use an animated transition when this value is greater than 0.
*/
Leaflet.prototype.zoomTo = function(viewOrExtent, flightDurationSeconds) {
    if (!defined(viewOrExtent)) {
        throw new DeveloperError('viewOrExtent is required.');
    }

    var extent;
    if (viewOrExtent instanceof Rectangle) {
        extent = viewOrExtent;
    } else {
        extent = viewOrExtent.rectangle;
    }

    // Account for a bounding box crossing the date line.
    if (extent.east < extent.west) {
        extent = Rectangle.clone(extent);
        extent.east += CesiumMath.TWO_PI;
    }

    this.map.fitBounds(rectangleToLatLngBounds(extent), {
        animate: flightDurationSeconds > 0.0
    });
};

/**
 * Captures a screenshot of the map.
 * @return {Promise} A promise that resolves to a data URL when the screenshot is ready.
 */
Leaflet.prototype.captureScreenshot = function() {
    var deferred = when.defer();

    // Temporarily hide the map credits.
    this.map.attributionControl.removeFrom(this.map);

    var that = this;

    try {
        html2canvas(this.map.getContainer(), {
            useCORS: true,
            onrendered: function(canvas) {
                var dataUrl;

                try {
                    dataUrl = canvas.toDataURL("image/jpeg");
                } catch (e) {
                    deferred.reject(e);
                }

                that.map.attributionControl.addTo(that.map);

                deferred.resolve(dataUrl);
            }
        });
    } catch (e) {
        that.map.attributionControl.addTo(that.map);
        deferred.reject(e);
    }

    return deferred.promise;
};

/**
 * Notifies the viewer that a repaint is required.
 */
Leaflet.prototype.notifyRepaintRequired = function() {
    // Leaflet doesn't need to do anything with this notification.
};

var cartographicScratch = new Cartographic();

/**
 * Computes the screen position of a given world position.
 * @param  {Cartesian3} position The world position in Earth-centered Fixed coordinates.
 * @param  {Cartesian2} [result] The instance to which to copy the result.
 * @return {Cartesian2} The screen position, or undefined if the position is not on the screen.
 */
Leaflet.prototype.computePositionOnScreen = function(position, result) {
    var cartographic = Ellipsoid.WGS84.cartesianToCartographic(position, cartographicScratch);
    var point = this.map.latLngToContainerPoint(L.latLng(CesiumMath.toDegrees(cartographic.latitude), CesiumMath.toDegrees(cartographic.longitude)));

    if (defined(result)) {
        result.x = point.x;
        result.y = point.y;
    } else {
        result = new Cartesian2(point.x, point.y);
    }
    return result;
};

function featurePicked(leaflet, entity) {
    leaflet._pickedFeatures.features.push(entity);
}

function prePickFeatures(leaflet) {
    leaflet._pickedFeatures = new PickedFeatures();
}

function pickFeatures(leaflet, latlng) {
    // We can't count on pickFeatures (triggered by click on the map) being called after before
    // featurePicked (triggered by click on an individual feature).  So don't resolve the pick
    // promise until we're sure all the click handlers have run, by waiting on a runLater.
    var promises = [];
    promises.push(runLater(function() {}));

    var dataSources = leaflet.application.nowViewing.items;

    var pickedXY = leaflet.map.latLngToContainerPoint(latlng, leaflet.map.getZoom());
    var bounds = leaflet.map.getBounds();
    var extent = new Rectangle(CesiumMath.toRadians(bounds.getWest()), CesiumMath.toRadians(bounds.getSouth()), CesiumMath.toRadians(bounds.getEast()), CesiumMath.toRadians(bounds.getNorth()));

    for (var i = 0; i < dataSources.length ; ++i) {
        var dataSource = dataSources[i];
        if (defined(dataSource.pickFeaturesInLeaflet)) {
            promises.push(dataSource.pickFeaturesInLeaflet(extent, leaflet.map.getSize().x, leaflet.map.getSize().y, pickedXY.x, pickedXY.y));
        }
    }

    leaflet._pickedFeatures.allFeaturesAvailablePromise = when.all(promises, function(results) {
        leaflet._pickedFeatures.isLoading = false;
        
        for (var resultIndex = 0; resultIndex < results.length; ++resultIndex) {
            var result = results[resultIndex];

            if (defined(result) && result.length > 0) {
                for (var featureIndex = 0; featureIndex < result.length; ++featureIndex) {
                    var feature = result[featureIndex];
                    leaflet._pickedFeatures.features.push(leaflet._createEntityFromImageryLayerFeature(feature, Cartographic.fromDegrees(latlng.lng, latlng.lat)));
                }
            }
        }
    }).otherwise(function() {
        leaflet._pickedFeatures.isLoading = false;
        leaflet._pickedFeatures.error = 'An unknown error occurred while picking features.';
    });
    leaflet.application.featuresPicked.raiseEvent(leaflet._pickedFeatures);
}

module.exports = Leaflet;
