export interface ClimateDashboardSection {
  key: 'climate' | 'fans' | 'blinds' | 'temperature' | 'humidity' | 'airQuality' | 'pressure';
  titleKey:
    | 'sections.climate.title'
    | 'sections.climate.fans.title'
    | 'sections.climate.blinds.title'
    | 'sections.climate.temperature.title'
    | 'sections.climate.humidity.title'
    | 'sections.climate.airQuality.title'
    | 'sections.climate.pressure.title';
  orderedIds: string[];
}
